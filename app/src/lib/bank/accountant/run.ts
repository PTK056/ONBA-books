import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nearestRate } from "../candidates";
import { CHARGE } from "../charges";
import { BankError, bankErrorOf } from "../errors";
import { buildDossiers, loadOrg, OPEN_LINE_FIELDS, type OpenLine } from "./context";
import { buildInput, Output, SYSTEM, toDrafts, type Draft } from "./propose";
import { money } from "./render";

// One pass of Sply Accountant over the lines left to do (of a statement, or all of them): bank charges get a
// proposal from code; the rest go to Claude in one call, with their dossiers, and come back as checked proposals.
// Nothing is written to the books here: only proposals, which a person accepts or declines. Every write goes
// through the checked functions of migration bank_accountant, as the user given by `db`.

const MODEL = process.env.ACCOUNTANT_MODEL ?? "claude-sonnet-5-5";
/** Lines sent to Claude in one pass; the rest wait for the next one ("Ask Sply" again). */
export const MAX_LINES = 60;

// One try, and a deadline well inside the function's time (a statement is read first, in the same request).
const client = new Anthropic({ timeout: 150_000, maxRetries: 1 });

export interface RunResult {
  runId: string | null;
  /** Lines given a proposal in this pass. */
  proposed: number;
  /** Lines still to do with no proposal (beyond MAX_LINES, or the pass failed). */
  left: number;
  error: string | null;
}

export async function runAccountant(
  db: SupabaseClient, orgId: string, opts: { trigger: "statement" | "app" | "chat"; statementId?: string },
): Promise<RunResult> {
  const org = await loadOrg(db, orgId);
  let q = db.from("bank_lines").select(OPEN_LINE_FIELDS).eq("organization_id", orgId).eq("status", "unmatched").order("date").limit(1000);
  if (opts.statementId) q = q.eq("statement_id", opts.statementId);
  const [{ data: lines, error }, { data: seen }, { data: accounts }] = await Promise.all([
    q,
    // Open, being applied, or declined: Sply does not propose again what the owner already saw.
    db.from("bank_proposals").select("line_id").eq("organization_id", orgId).in("status", ["pending", "accepted", "rejected"]),
    db.from("bank_accounts").select("id, name, last4").eq("organization_id", orgId),
  ]);
  if (error) throw new BankError("failed", "Could not load the bank lines. Try again.");
  const skip = new Set((seen ?? []).map((x) => x.line_id as string));
  const todo = ((lines ?? []) as OpenLine[]).filter((l) => !skip.has(l.id)).map((l) => ({ ...l, amount: Number(l.amount) }));
  if (!todo.length) return { runId: null, proposed: 0, left: 0, error: null };

  const charges = todo.filter((l) => CHARGE.test(l.description));
  const now = todo.filter((l) => !CHARGE.test(l.description)).slice(0, MAX_LINES);

  const { data: runId, error: startError } = await db.rpc("bank_run_start", {
    p_org: orgId, p_statement: opts.statementId ?? null, p_trigger: opts.trigger, p_lines: charges.length + now.length,
    p_model: now.length ? MODEL : null,
  });
  if (startError) {
    const e = bankErrorOf(startError.message);
    if (/^busy:/.test(startError.message)) return { runId: null, proposed: 0, left: todo.length, error: startError.message.replace(/^busy: /, "") };
    throw e;
  }

  const rows: Record<string, unknown>[] = charges.map((l) => ({
    action: "charges", line_id: l.id, statement_id: l.statement_id, confidence: "high",
    why: "Bank fees and interest are booked together, one entry a month, where Settings says.",
  }));
  let failure: string | null = null;
  let usage: { input_tokens: number; output_tokens: number } | null = null;

  if (now.length) {
    const { data: granted } = await db.rpc("ai_take", { org: orgId, k: "bank_review", wanted: 1 });
    if (!granted) {
      failure = "This month's Sply Accountant allowance is used up; it renews on the 1st.";
    } else {
      try {
        const names = new Map((accounts ?? []).map((a) => [a.id as string, a.last4 ? `${a.name} ••••${a.last4}` : a.name as string]));
        const dossiers = await buildDossiers(db, org, now, names);
        // create, not parse: the usage and the stop reason are kept even when the answer cannot be used.
        const r = await client.messages.create({
          model: MODEL,
          max_tokens: 32000,
          system: SYSTEM,
          output_config: { effort: "medium", format: zodOutputFormat(Output) },
          messages: [{ role: "user", content: JSON.stringify(buildInput(org, dossiers)) }],
        });
        usage = { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens };
        if (r.stop_reason !== "end_turn") throw new Error(`stopped: ${r.stop_reason}`);
        const text = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        const answer = Output.safeParse(JSON.parse(text));
        if (!answer.success) throw new Error(`unreadable answer: ${answer.error.message.slice(0, 200)}`);
        const drafts = await withRates(db, org, now, toDrafts(answer.data, dossiers, org));
        rows.push(...drafts.map(toRow));
      } catch (e) {
        console.error("[accountant]", orgId, e);
        failure = e instanceof BankError ? e.message : "Sply Accountant could not finish this time. Try again in a few minutes.";
      }
    }
  }

  let written = 0;
  for (const row of rows) {
    const { data: id, error: e } = await db.rpc("bank_proposal_add", { p_run: runId, p: row });
    if (id) written++;
    else if (e) console.error("[accountant] proposal:", e.message);
  }
  await db.rpc("bank_run_finish", {
    p_run: runId, p_proposals: written, p_error: failure,
    p_input: usage?.input_tokens ?? null, p_output: usage?.output_tokens ?? null,
  });
  return { runId: runId as string, proposed: written, left: await openWithoutProposal(db, orgId, opts.statementId), error: failure };
}

/** An add for a line not in the reporting currency carries the rate it will use, shown to the owner; none: a question. */
async function withRates(db: SupabaseClient, org: { id: string; reportingCurrency: string }, lines: OpenLine[], drafts: Draft[]) {
  const byId = new Map(lines.map((l) => [l.id, l]));
  return Promise.all(drafts.map(async (d): Promise<Draft & { fxRate?: number }> => {
    const l = byId.get(d.lineId)!;
    if (d.action !== "add" || l.currency === org.reportingCurrency) return d;
    const near = await nearestRate(db, org.id, l.currency, l.date);
    if (!near) {
      return { ...d, action: "ask", villaId: null, categoryId: null, description: null, confidence: "low",
        question: `${d.why ? `${d.why} ` : ""}What was the ${l.currency} → ${org.reportingCurrency} rate for ${money(Number(l.amount), l.currency)} on ${l.date}?`.slice(0, 400) };
    }
    return { ...d, fxRate: near.rate, confidence: d.confidence === "high" ? "medium" : d.confidence,
      why: `${d.why} Rate: 1 ${l.currency} = ${money(near.rate, org.reportingCurrency)} (used on ${near.date}).`.trim().slice(0, 400) };
  }));
}

/** Lines still to do that have no proposal open or being applied. */
async function openWithoutProposal(db: SupabaseClient, orgId: string, statementId?: string): Promise<number> {
  let lines = db.from("bank_lines").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "unmatched");
  if (statementId) lines = lines.eq("statement_id", statementId);
  let open = db.from("bank_proposals").select("id, line:bank_lines!inner (status, statement_id)", { count: "exact", head: true })
    .eq("organization_id", orgId).in("status", ["pending", "accepted", "rejected"]).eq("line.status", "unmatched");
  if (statementId) open = open.eq("line.statement_id", statementId);
  const [{ count: a }, { count: b }] = await Promise.all([lines, open]);
  return Math.max(0, (a ?? 0) - (b ?? 0));
}

function toRow(d: Draft & { fxRate?: number }): Record<string, unknown> {
  return {
    line_id: d.lineId, action: d.action, villa_id: d.villaId, category_id: d.categoryId, description: d.description,
    transaction_id: d.transactionId, stay_ids: d.stayIds, personal_reason: d.personalReason, amount_differs: d.amountDiffers,
    fx_rate: d.fxRate ?? null, confidence: d.confidence, why: d.why || "—", question: d.question,
  };
}
