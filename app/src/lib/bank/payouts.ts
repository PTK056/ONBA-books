import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Platform payouts read from e-mails (stay_payouts), and whether each one has reached the bank:
// a line linked to its stay for the same amount. One stay can have several payouts (a night added
// after booking is paid separately), so this is per payout, not per stay.

export interface PayoutState {
  key: string;               // payout_ref + code
  code: string;
  stayId: string | null;     // null: booking not in the books
  guest: string | null;
  sentOn: string;
  arrivesBy: string | null;
  received: number;          // in the bank's currency
  currency: string;
  lineId: string | null;     // the bank line that brought it, once linked
}

export async function payoutStates(db: SupabaseClient, orgId: string, sinceDate: string): Promise<PayoutState[]> {
  const { data: payouts } = await db.from("stay_payouts")
    .select("payout_ref, code, sent_on, arrives_by, received, received_currency")
    .eq("organization_id", orgId).gte("sent_on", sinceDate).order("sent_on");
  if (!payouts?.length) return [];
  const codes = [...new Set(payouts.map((p) => p.code))];
  const { data: stays } = await db.from("stays").select("id, external_ref, guest_name, links:bank_line_stays (line:bank_lines (id, amount))")
    .eq("organization_id", orgId).eq("platform", "airbnb").in("external_ref", codes);
  type StayRow = { id: string; external_ref: string; guest_name: string | null; links: { line: { id: string; amount: number } | null }[] };
  const byCode = new Map(((stays ?? []) as unknown as StayRow[]).map((s) => [s.external_ref, s]));

  const assigned = new Set<string>();
  return payouts.map((p) => {
    const stay = byCode.get(p.code);
    const line = stay?.links.map((l) => l.line).find((l) => l && !assigned.has(l.id) && Math.abs(Number(l.amount) - Number(p.received)) < 1);
    if (line) assigned.add(line.id);
    return {
      key: `${p.payout_ref}|${p.code}`, code: p.code, stayId: stay?.id ?? null, guest: stay?.guest_name ?? null,
      sentOn: p.sent_on, arrivesBy: p.arrives_by, received: Number(p.received), currency: p.received_currency, lineId: line?.id ?? null,
    };
  });
}
