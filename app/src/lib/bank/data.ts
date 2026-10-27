import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHARGE, shift } from "./ops";

export interface BankStatementRow {
  id: string; account: string; periodStart: string | null; periodEnd: string | null;
  linesAdded: number; linesSkipped: number; balanced: boolean | null; notes: string | null; charges: number;
}
export interface Suggestion { id: string; date: string; description: string; category: string | null }
export interface BankLineRow {
  id: string; statementId: string; account: string; date: string; direction: "in" | "out"; amount: number; currency: string;
  description: string; counterparty: string | null; status: "unmatched" | "matched" | "personal"; matchedBy: string | null;
  /** What the line is linked to, in words. */
  linkedTo: string | null;
  suggestions: Suggestion[];
}

const SUGGEST_DAYS = 31;

export async function bankPage(db: SupabaseClient, orgId: string) {
  const [{ data: accounts }, { data: statements }, { data: lines }] = await Promise.all([
    db.from("bank_accounts").select("id, name, last4").eq("organization_id", orgId),
    db.from("bank_statements")
      .select("id, account_id, period_start, period_end, lines_added, lines_skipped, balanced, notes")
      .eq("organization_id", orgId).order("period_start", { ascending: false }),
    db.from("bank_lines")
      .select("id, statement_id, account_id, date, direction, amount, currency, description, counterparty, status, matched_by, "
        + "transaction:transactions (date, description, category:categories (name)), stays:bank_line_stays (stay:stays (external_ref, guest_name, check_in))")
      .eq("organization_id", orgId).order("date", { ascending: false }).limit(1000),
  ]);
  const accountName = new Map((accounts ?? []).map((a) => [a.id, a.last4 ? `${a.name} ••••${a.last4}` : a.name]));

  type Row = {
    id: string; statement_id: string; account_id: string; date: string; direction: "in" | "out"; amount: number; currency: string;
    description: string; counterparty: string | null; status: BankLineRow["status"]; matched_by: string | null;
    transaction: { date: string; description: string | null; category: { name: string } | null } | null;
    stays: { stay: { external_ref: string | null; guest_name: string | null; check_in: string } }[];
  };
  const rows = (lines ?? []) as unknown as Row[];

  // Entries the user could link an unmatched line to: same amount, within a month, not linked yet.
  const open = rows.filter((r) => r.status === "unmatched");
  const candidates: { id: string; date: string; direction: string; amount: number; amount_reporting: number; currency: string; description: string | null; category: { name: string } | null }[] = [];
  if (open.length) {
    const dates = open.map((r) => r.date).sort();
    const [{ data: txs }, { data: taken }] = await Promise.all([
      db.from("transactions").select("id, date, direction, amount, amount_reporting, currency, description, category:categories (name)")
        .eq("organization_id", orgId).eq("status", "validated").is("stay_id", null)
        .gte("date", shift(dates[0], -SUGGEST_DAYS)).lte("date", shift(dates.at(-1)!, SUGGEST_DAYS)),
      db.from("bank_lines").select("transaction_id").eq("organization_id", orgId).not("transaction_id", "is", null),
    ]);
    const used = new Set((taken ?? []).map((t) => t.transaction_id));
    candidates.push(...((txs ?? []) as unknown as typeof candidates).filter((t) => !used.has(t.id)));
  }
  const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= SUGGEST_DAYS * 86_400_000;

  const out: BankLineRow[] = rows.map((r) => {
    const stays = r.stays.map((x) => x.stay);
    const linkedTo = r.transaction
      ? [r.transaction.category?.name, r.transaction.description].filter(Boolean).join(" · ") || "An entry"
      : stays.length ? `Airbnb ${stays.map((x) => x.external_ref ?? x.check_in).join(", ")}` : null;
    const suggestions = r.status !== "unmatched" ? [] : candidates
      .filter((t) => t.direction === r.direction && near(t.date, r.date)
        && (Number(t.amount) === Number(r.amount) || Math.abs(Number(t.amount_reporting) - Number(r.amount)) < 1))
      .slice(0, 3)
      .map((t) => ({ id: t.id, date: t.date, description: t.description ?? "", category: t.category?.name ?? null }));
    return {
      id: r.id, statementId: r.statement_id, account: accountName.get(r.account_id) ?? "", date: r.date, direction: r.direction,
      amount: Number(r.amount), currency: r.currency, description: r.description, counterparty: r.counterparty,
      status: r.status, matchedBy: r.matched_by, linkedTo, suggestions,
    };
  });

  const charges = new Map<string, number>();
  for (const r of open) if (CHARGE.test(r.description)) charges.set(r.statement_id, (charges.get(r.statement_id) ?? 0) + 1);
  const stmts: BankStatementRow[] = (statements ?? []).map((s) => ({
    id: s.id, account: accountName.get(s.account_id) ?? "", periodStart: s.period_start, periodEnd: s.period_end,
    linesAdded: s.lines_added, linesSkipped: s.lines_skipped, balanced: s.balanced, notes: s.notes, charges: charges.get(s.id) ?? 0,
  }));
  return { statements: stmts, lines: out };
}
