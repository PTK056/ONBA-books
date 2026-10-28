import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchLines, type BookEntry, type StayNet } from "./match";
import type { Statement } from "./statement-pdf";

// Writing a read statement to the books' side tables, and linking its lines to what is already there.
// Runs with the caller's client: RLS keeps all of it to admins.

/** Bank charges and interest, booked together rather than line by line. */
export const CHARGE = /\b(FEE|FEES|BIAYA|ADM|ADMIN|CHARGE|TAX|PAJAK|INTEREST|BUNGA)\b/i;
export const INTEREST = /\b(INTEREST|BUNGA)\b/i;
/** Tax the bank withholds on interest (Indonesia: 20% final tax). */
export const WITHHELD_TAX = /\b(TAX|PAJAK)\b/i;

export interface Ingested { statementId: string; accountId: string; added: number; skipped: number }

/** Finds or creates the account the statement belongs to, then stores the statement and its new lines. */
export async function ingestStatement(
  db: SupabaseClient, orgId: string, s: Statement, file: { path: string; name: string; mimeType: string },
): Promise<Ingested> {
  const institution = /danamon/i.test(s.bank) ? "danamon" : /wise|transferwise/i.test(s.bank) ? "wise" : "other";
  let q = db.from("bank_accounts").select("id").eq("organization_id", orgId).eq("institution", institution).eq("currency", s.currency);
  q = s.account_last4 ? q.eq("last4", s.account_last4) : q.is("last4", null);
  const { data: found } = await q.limit(1);
  let accountId = found?.[0]?.id as string | undefined;
  if (!accountId) {
    const name = `${institution === "other" ? s.bank : institution[0].toUpperCase() + institution.slice(1)} ${s.currency}`;
    const { data, error } = await db.from("bank_accounts")
      .insert({ organization_id: orgId, name, institution, currency: s.currency, last4: s.account_last4 }).select("id").single();
    if (error || !data) throw new Error(`bank_accounts: ${error?.message}`);
    accountId = data.id as string;
  }

  const { data: st, error: stErr } = await db.from("bank_statements").insert({
    organization_id: orgId, account_id: accountId, storage_path: file.path, file_name: file.name, mime_type: file.mimeType,
    period_start: s.period_start, period_end: s.period_end, opening_balance: s.opening_balance, closing_balance: s.closing_balance,
    balanced: s.balanced, notes: s.notes,
  }).select("id").single();
  if (stErr || !st) throw new Error(`bank_statements: ${stErr?.message}`);

  // Identical lines (same day, amount and text) are told apart by their order in the statement.
  const seen = new Map<string, number>();
  const rows = s.lines.map((l) => {
    const base = [l.date, l.direction, l.amount.toFixed(2), l.reference ?? "", l.description].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return {
      organization_id: orgId, account_id: accountId, statement_id: st.id, date: l.date, direction: l.direction,
      amount: l.amount, currency: s.currency, description: l.description, counterparty: l.counterparty,
      reference: l.reference, balance: l.balance, fingerprint: `${base}|${n}`,
    };
  });
  const { data: added, error } = await db.from("bank_lines")
    .upsert(rows, { onConflict: "account_id,fingerprint", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(`bank_lines: ${error.message}`);
  const count = added?.length ?? 0;
  await db.from("bank_statements").update({ lines_added: count, lines_skipped: rows.length - count }).eq("id", st.id);
  return { statementId: st.id, accountId, added: count, skipped: rows.length - count };
}

/** Links every unmatched line of the organization that has an obvious counterpart in the books. Returns how many. */
export async function autoMatch(db: SupabaseClient, orgId: string, reportingCurrency: string): Promise<number> {
  const { data: lines } = await db.from("bank_lines").select("id, date, direction, amount, currency")
    .eq("organization_id", orgId).eq("status", "unmatched").order("date");
  if (!lines?.length) return 0;
  const from = shift(lines[0].date, -40);
  const to = shift(lines[lines.length - 1].date, 10);

  const [{ data: txs }, { data: taken }, { data: stays }, { data: paidStays }] = await Promise.all([
    db.from("transactions").select("id, date, direction, amount, currency, amount_reporting")
      .eq("organization_id", orgId).eq("status", "validated").is("stay_id", null).gte("date", from).lte("date", to),
    db.from("bank_lines").select("transaction_id").eq("organization_id", orgId).not("transaction_id", "is", null),
    db.from("stays").select("id, check_in, check_out, payout_date, transactions (direction, amount_reporting, status)")
      // Any stay a line could pay: a deposit up to three months before arrival, an extension until just after departure.
      .eq("organization_id", orgId).gte("check_out", shift(from, -5)).lte("check_in", shift(to, 90)),
    db.from("bank_line_stays").select("stay_id").eq("organization_id", orgId),
  ]);
  const used = new Set((taken ?? []).map((t) => t.transaction_id as string));
  const entries: BookEntry[] = (txs ?? []).filter((t) => !used.has(t.id)).map((t) => ({
    id: t.id, date: t.date, direction: t.direction, amount: Number(t.amount), currency: t.currency, amountReporting: Number(t.amount_reporting),
  }));
  const paid = new Set((paidStays ?? []).map((x) => x.stay_id as string));
  type StayRow = { id: string; check_in: string; check_out: string; payout_date: string | null; transactions: { direction: string; amount_reporting: number; status: string }[] };
  const nets: StayNet[] = ((stays ?? []) as StayRow[]).filter((x) => !paid.has(x.id)).map((x) => ({
    id: x.id, checkIn: x.check_in, checkOut: x.check_out, payoutDate: x.payout_date,
    netReporting: x.transactions.filter((t) => t.status === "validated")
      .reduce((s, t) => s + (t.direction === "in" ? 1 : -1) * Number(t.amount_reporting), 0),
  }));

  const matches = matchLines(
    lines.map((l) => ({ ...l, amount: Number(l.amount) })), entries, nets, reportingCurrency,
  );
  for (const m of matches) {
    if (m.kind === "transaction") {
      await db.from("bank_lines").update({ status: "matched", transaction_id: m.transactionId, matched_by: "auto" }).eq("id", m.lineId);
    } else {
      await db.from("bank_line_stays").insert(m.stayIds.map((stay_id) => ({ organization_id: orgId, line_id: m.lineId, stay_id })));
      await db.from("bank_lines").update({ status: "matched", matched_by: "auto" }).eq("id", m.lineId);
    }
  }
  return matches.length;
}

export function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
