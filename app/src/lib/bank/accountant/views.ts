import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { whereIn } from "../candidates";
import type { ProposalView } from "./render";

/** As private.bank_proposal_lease() in migration bank_accountant. */
const LEASE_MS = 10 * 60_000;

const FIELDS = "id, run_id, line_id, action, status, confidence, why, question, outcome, amount_differs, description, stay_ids, "
  + "personal_reason, statement_id, telegram, "
  + "line:bank_lines (date, direction, amount, currency, counterparty, description), "
  + "villa:villas (name), category:categories (name), entry:transactions (date, amount, currency, description)";

type Row = {
  id: string; run_id: string; line_id: string; action: ProposalView["action"]; status: ProposalView["status"];
  confidence: ProposalView["confidence"]; why: string; question: string | null; outcome: string | null; amount_differs: boolean;
  description: string | null; stay_ids: string[] | null; personal_reason: string | null; statement_id: string | null;
  telegram: { chat: string; message: number }[];
  line: { date: string; direction: "in" | "out"; amount: number; currency: string; counterparty: string | null; description: string };
  villa: { name: string } | null; category: { name: string } | null;
  entry: { date: string; amount: number; currency: string; description: string | null } | null;
};

/** Proposals with what they show: the line, the villa and category names, the entry, the stays. Oldest line first. */
export async function listProposals(
  db: SupabaseClient, orgId: string, filter: { runId?: string; ids?: string[]; pending?: boolean },
): Promise<ProposalView[]> {
  let q = db.from("bank_proposals").select(FIELDS).eq("organization_id", orgId).order("created_at");
  if (filter.runId) q = q.eq("run_id", filter.runId);
  if (filter.ids) q = q.in("id", filter.ids.length ? filter.ids : ["00000000-0000-0000-0000-000000000000"]);
  // Open: pending, or accepted long ago with no outcome (the server stopped while applying it), decidable again.
  const leaseEnd = new Date(Date.now() - LEASE_MS).toISOString();
  if (filter.pending) q = q.or(`status.eq.pending,and(status.eq.accepted,decided_at.lt.${leaseEnd})`);
  const { data, error } = await q.limit(500);
  if (error) throw new Error(`bank_proposals: ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];
  const stayIds = [...new Set(rows.flatMap((r) => r.stay_ids ?? []))];
  const stays = stayIds.length
    ? await whereIn<{ id: string; guest_name: string | null; external_ref: string | null; check_in: string }>(
      db, orgId, "stays", "id, guest_name, external_ref, check_in", "id", stayIds)
    : [];
  return rows.map((r) => ({
    id: r.id, runId: r.run_id, lineId: r.line_id, action: r.action, status: r.status === "accepted" && filter.pending ? "pending" : r.status,
    confidence: r.confidence,
    why: r.why, question: r.question, outcome: r.outcome, amountDiffers: r.amount_differs,
    line: { ...r.line, amount: Number(r.line.amount) },
    villa: r.villa?.name ?? null, category: r.category?.name ?? null, description: r.description,
    entry: r.entry ? { ...r.entry, amount: Number(r.entry.amount) } : null,
    stays: (r.stay_ids ?? []).map((id) => stays.find((x) => x.id === id))
      .filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ guest: x.guest_name, reference: x.external_ref, checkIn: x.check_in })),
    personalReason: r.personal_reason, statementId: r.statement_id, telegram: r.telegram ?? [],
  })).sort((a, b) => a.line.date.localeCompare(b.line.date) || a.id.localeCompare(b.id));
}
