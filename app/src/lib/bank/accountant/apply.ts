import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bookStatementCharges } from "../book-charges";
import { nearestRate } from "../candidates";
import { BankError, bankErrorOf } from "../errors";
import { bookLine, cancelLines, linkEntry, linkStays, markLinePersonal, type PersonalReason } from "../handle";
import { learnPayees } from "../ops";
import { loadOrg } from "./context";
import { isSure, oneChargePerStatement } from "./render";
import { listProposals } from "./views";

// Accepting a proposal runs the bank action it describes, as the person who accepted (RLS, admins only); no AI.
// The first decision wins: the proposal is claimed in the database before anything is written.

type Row = {
  id: string; organization_id: string; line_id: string; action: string; villa_id: string | null; category_id: string | null;
  description: string | null; transaction_id: string | null; stay_ids: string[] | null; personal_reason: string | null;
  statement_id: string | null; amount_differs: boolean; fx_rate: number | null; why: string; status: string;
  /** Lines that cancel out, proposed together: the whole set, this line included. */
  line_ids: string[] | null;
};

export interface Decided { id: string; status: "applied" | "rejected" | "failed" | "stale"; outcome: string | null }

export async function decideProposal(db: SupabaseClient, proposalId: string, decision: "accept" | "reject"): Promise<Decided> {
  const { data: before } = await db.from("bank_proposals").select("action, status").eq("id", proposalId).maybeSingle();
  if (!before) throw new BankError("not_found", "No such proposal.");
  if (decision === "accept" && before.action === "ask") throw new BankError("failed", "That is a question: answer it, or handle the line in the Bank tab.");

  const { data, error } = await db.rpc("bank_proposal_claim", { p_proposal: proposalId, p_status: decision === "accept" ? "accepted" : "rejected" });
  if (error) throw bankErrorOf(error.message);
  const p = (Array.isArray(data) ? data[0] : data) as Row;
  if (decision === "reject") {
    if (p.action === "charges") await db.rpc("bank_proposal_group", { p_proposal: p.id, p_status: "rejected" });
    if (p.line_ids) await db.rpc("bank_proposal_set_rejected", { p_proposal: p.id });
    return { id: p.id, status: "rejected", outcome: null };
  }

  let status: Decided["status"] = "applied";
  let outcome: string;
  try {
    outcome = await apply(db, p);
    if (p.action === "charges") await db.rpc("bank_proposal_group", { p_proposal: p.id, p_status: "applied" });
  } catch (e) {
    if (e instanceof BankError) {
      status = e.code === "already_handled" ? "stale" : "failed";
      outcome = e.message;
    } else {
      // A network error after the write went through: the line says whether it did.
      console.error("[accountant] apply:", e);
      const { data: line } = await db.from("bank_lines").select("status, handled_via, handled_note").eq("id", p.line_id).maybeSingle();
      const done = !!line && line.status !== "unmatched" && line.handled_via === "agent" && (line.handled_note ?? "").startsWith("Proposed by Sply");
      status = done ? "applied" : "failed";
      outcome = done ? "Done." : "Could not apply it. Try again in the Bank tab.";
    }
  }
  const { error: finishError } = await db.rpc("bank_proposal_finish", { p_proposal: p.id, p_status: status, p_outcome: outcome });
  if (finishError) console.error("[accountant] finish:", finishError.message);
  if (status === "applied") await learnPayees(db, p.organization_id);
  return { id: p.id, status, outcome };
}

async function apply(db: SupabaseClient, p: Row): Promise<string> {
  const note = `Proposed by Sply: ${p.why}`.slice(0, 500);
  switch (p.action) {
    case "add": {
      const { data: line } = await db.from("bank_lines").select("date, currency").eq("id", p.line_id).single();
      const { data: org } = await db.from("organizations").select("reporting_currency").eq("id", p.organization_id).single();
      let fx: number | null = 1;
      if (line && org && line.currency !== org.reporting_currency) {
        // The rate shown in the proposal; a proposal without one (made before rates were stored) looks it up.
        fx = p.fx_rate ? Number(p.fx_rate) : (await nearestRate(db, p.organization_id, line.currency, line.date))?.rate ?? null;
        if (!fx) throw new BankError("fx_rate_required", `No ${line.currency} rate on file near that date: add it in the Bank tab with the rate.`);
      }
      await bookLine(db, p.line_id, { villaId: p.villa_id!, categoryId: p.category_id, description: p.description, fxRate: fx, via: "agent", note });
      return "Added to the books.";
    }
    case "link":
      if (!p.transaction_id) throw new BankError("not_found", "The entry it pointed to was deleted.");
      await linkEntry(db, p.line_id, p.transaction_id, "agent", note, !p.amount_differs);
      return "Linked to the entry.";
    case "link_stays":
      await linkStays(db, p.line_id, p.stay_ids ?? [], "agent", note);
      return "Linked to the stays.";
    case "personal":
      if (p.personal_reason === "returned") {
        // The whole set or nothing: the database checks they are all still to do and come to zero.
        if (!p.line_ids || p.line_ids.length < 2) throw new BankError("failed", "The lines that cancel out are missing: handle them in the Bank tab.");
        await cancelLines(db, p.line_ids, "agent", note);
        return `Set aside with the ${p.line_ids.length - 1} line${p.line_ids.length === 2 ? "" : "s"} it cancels out with.`;
      }
      await markLinePersonal(db, p.line_id, p.personal_reason as PersonalReason, "agent", note);
      return "Marked personal.";
    case "charges": {
      const org = await loadOrg(db, p.organization_id);
      const r = await bookStatementCharges(db, org, p.statement_id!, "agent", note);
      if (r.problem && !r.booked) throw new BankError("failed", r.problem);
      return `Bank charges booked: ${r.booked} entr${r.booked === 1 ? "y" : "ies"}, ${r.lines} lines${r.problem ? ` (${r.problem})` : ""}.`;
    }
    default:
      throw new BankError("failed", "Nothing to apply.");
  }
}

/**
 * Accepts every sure proposal still pending (of one pass, or all of them), or only the first `limit` of them in the
 * order they are listed (Telegram lists a few: OK accepts what was shown). A statement's charges count once.
 */
export async function acceptSure(db: SupabaseClient, orgId: string, runId?: string, limit?: number): Promise<{ applied: number; failed: number; decided: Decided[] }> {
  // With a limit, the sure ones listed when the pass was sent (all of its sure ones, in list order, whatever has been
  // decided since), of which those still open: deciding one of them first never lets an unlisted one in.
  const listed = limit === undefined
    ? oneChargePerStatement((await listProposals(db, orgId, { runId, pending: true })).filter(isSure))
    : oneChargePerStatement((await listProposals(db, orgId, { runId })).filter(isSure)).slice(0, limit)
      .filter((v) => v.status === "pending" || v.status === "accepted");
  const views = listed;
  const decided: Decided[] = [];
  for (const v of views) {
    try { decided.push(await decideProposal(db, v.id, "accept")); } catch { /* decided meanwhile */ }
  }
  return { applied: decided.filter((d) => d.status === "applied").length, failed: decided.filter((d) => d.status === "failed").length, decided };
}
