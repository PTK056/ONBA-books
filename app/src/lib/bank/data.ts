import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nameFit, namesOf } from "./match";
import { payeeKey } from "./payees";
import { CHARGE, shift } from "./ops";
import { payoutStates } from "./payouts";
import { LINK_DAYS, monthlyTemplate, retitle, type PastEntry, type Template } from "./recurring";

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
  /** A monthly payment whose month is missing: book it like the neighbouring month's entry. */
  template: Template | null;
  /** Incoming: stays this transfer could pay (deposit before arrival, balance, extension). */
  stays: StaySuggestion[];
  /** A regular payee: where their last payment was booked. */
  known: KnownPayee | null;
}
export interface KnownPayee {
  villaId: string; villa: string; categoryId: string | null; category: string | null; description: string | null; uses: number;
}
export interface StaySuggestion { id: string; guest: string | null; platform: string; checkIn: string; checkOut: string }

const AROUND_DAYS = 45; // wide enough to see last month's and next month's entries

/** A payout Airbnb sent (read from its e-mail) that no bank line has brought yet. */
export interface ExpectedPayout {
  key: string; code: string; guest: string | null; sentOn: string; arrivesBy: string | null; received: number; currency: string;
  /** late: the statements go past its arrival date (plus a few days) and it isn't there; waiting: no statement that far yet. */
  state: "on_its_way" | "late" | "no_statement_yet";
}
/** A stay booked from its confirmation, arrived some days ago, and no payout read for it. */
export interface UnpaidStay { id: string; code: string; guest: string | null; checkIn: string }

const PAYOUTS_SINCE_DAYS = 120;
const LATE_AFTER_DAYS = 3;   // past Airbnb's "should arrive by"
const UNPAID_AFTER_DAYS = 3; // Airbnb pays about a day after arrival

export async function bankPage(db: SupabaseClient, orgId: string) {
  const [{ data: accounts }, { data: statements }, { data: lines }, { data: payees }, { data: villas }, { data: cats }] = await Promise.all([
    db.from("bank_accounts").select("id, name, last4").eq("organization_id", orgId),
    db.from("bank_statements")
      .select("id, account_id, period_start, period_end, lines_added, lines_skipped, balanced, notes")
      .eq("organization_id", orgId).order("period_start", { ascending: false }),
    db.from("bank_lines")
      .select("id, statement_id, account_id, date, direction, amount, currency, description, counterparty, payee_last4, status, matched_by, "
        + "transaction:transactions (date, description, category:categories (name)), stays:bank_line_stays (stay:stays (external_ref, guest_name, check_in))")
      .eq("organization_id", orgId).order("date", { ascending: false }).limit(1000),
    db.from("bank_payees").select("key, direction, villa_id, category_id, description, uses, last_used").eq("organization_id", orgId),
    db.from("villas").select("id, name").eq("organization_id", orgId),
    db.from("categories").select("id, name").eq("organization_id", orgId),
  ]);
  const accountName = new Map((accounts ?? []).map((a) => [a.id, a.last4 ? `${a.name} ••••${a.last4}` : a.name]));

  type Row = {
    id: string; statement_id: string; account_id: string; date: string; direction: "in" | "out"; amount: number; currency: string;
    description: string; counterparty: string | null; payee_last4: string | null; status: BankLineRow["status"]; matched_by: string | null;
    transaction: { date: string; description: string | null; category: { name: string } | null } | null;
    stays: { stay: { external_ref: string | null; guest_name: string | null; check_in: string } }[];
  };
  const rows = (lines ?? []) as unknown as Row[];

  // Entries around the unmatched lines: to link one (close and not linked yet), or to copy last month's.
  const open = rows.filter((r) => r.status === "unmatched");
  const around: (PastEntry & { linked: boolean })[] = [];
  if (open.length) {
    const dates = open.map((r) => r.date).sort();
    const [{ data: txs }, { data: taken }] = await Promise.all([
      db.from("transactions").select("id, date, direction, amount, amount_reporting, villa_id, category_id, description, category:categories (name)")
        .eq("organization_id", orgId).eq("status", "validated").is("stay_id", null)
        .gte("date", shift(dates[0], -AROUND_DAYS)).lte("date", shift(dates.at(-1)!, AROUND_DAYS)),
      db.from("bank_lines").select("transaction_id").eq("organization_id", orgId).not("transaction_id", "is", null),
    ]);
    const used = new Set((taken ?? []).map((t) => t.transaction_id));
    type Tx = { id: string; date: string; direction: "in" | "out"; amount: number; amount_reporting: number; villa_id: string; category_id: string | null; description: string | null; category: { name: string } | null };
    around.push(...((txs ?? []) as unknown as Tx[]).map((t) => ({
      id: t.id, date: t.date, direction: t.direction, amount: Number(t.amount), amountReporting: Number(t.amount_reporting),
      villaId: t.villa_id, categoryId: t.category_id, category: t.category?.name ?? null, description: t.description, linked: used.has(t.id),
    })));
  }
  // Stays an incoming transfer could pay: arrival up to 90 days after it, or departure up to 5 days before it.
  const incoming = open.filter((r) => r.direction === "in");
  let staysAround: StaySuggestion[] = [];
  if (incoming.length) {
    const dates = incoming.map((r) => r.date).sort();
    const { data } = await db.from("stays").select("id, guest_name, platform, check_in, check_out")
      .eq("organization_id", orgId).gte("check_out", shift(dates[0], -5)).lte("check_in", shift(dates.at(-1)!, 90)).order("check_in");
    staysAround = (data ?? []).map((x) => ({ id: x.id, guest: x.guest_name, platform: x.platform, checkIn: x.check_in, checkOut: x.check_out }));
  }
  const staysFor = (date: string) => staysAround
    .filter((x) => shift(date, 90) >= x.checkIn && shift(x.checkOut, 5) >= date)
    .sort((a, b) => Math.abs(Date.parse(a.checkIn) - Date.parse(date)) - Math.abs(Date.parse(b.checkIn) - Date.parse(date)))
    .slice(0, 3);

  const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= LINK_DAYS * 86_400_000;

  // Regular payees: where their last payment was booked.
  const villaName = new Map((villas ?? []).map((v) => [v.id, v.name]));
  const catName = new Map((cats ?? []).map((c) => [c.id, c.name]));
  const memory = new Map((payees ?? []).filter((p) => p.villa_id).map((p) => [`${p.key}|${p.direction}`, p]));
  const knownFor = (r: { date: string; direction: string; description: string; counterparty: string | null; payee_last4: string | null }): KnownPayee | null => {
    const key = payeeKey(r);
    const p = key ? memory.get(`${key}|${r.direction}`) : undefined;
    if (!p) return null;
    return {
      villaId: p.villa_id!, villa: villaName.get(p.villa_id!) ?? "", categoryId: p.category_id,
      category: p.category_id ? catName.get(p.category_id) ?? null : null, uses: p.uses,
      // "… August 2026" last time, paid in October: "… October 2026".
      description: p.description ? retitle(p.description, p.last_used, r.date) : null,
    };
  };
  const named = namesOf(open.map((r) => ({ id: r.id, text: [r.counterparty, r.description].filter(Boolean).join(" · ") })));
  const out: BankLineRow[] = rows.map((r) => {
    const stays = r.stays.map((x) => x.stay);
    const linkedTo = r.transaction
      ? [r.transaction.category?.name, r.transaction.description].filter(Boolean).join(" · ") || "An entry"
      : stays.length ? `Airbnb ${stays.map((x) => x.external_ref ?? x.check_in).join(", ")}` : null;
    const line = { date: r.date, direction: r.direction, amount: Number(r.amount) };
    // Same amount within two weeks; an entry naming this line's payee first, one naming another payee left out.
    const close = r.status !== "unmatched" ? [] : around
      .filter((t) => !t.linked && t.direction === r.direction && near(t.date, r.date)
        && (t.amount === line.amount || Math.abs(t.amountReporting - line.amount) < 1))
      .map((t) => ({ t, fit: nameFit(t.description, { id: r.id }, named) }))
      .filter((x) => x.fit !== "other");
    const suggestions = (close.some((x) => x.fit === "this") ? close.filter((x) => x.fit === "this") : close)
      .slice(0, 3)
      .map(({ t }) => ({ id: t.id, date: t.date, description: t.description ?? "", category: t.category }));
    const template = r.status === "unmatched" ? monthlyTemplate(line, around) : null;
    const payable = r.status === "unmatched" && r.direction === "in" ? staysFor(r.date) : [];
    const known = r.status === "unmatched" ? knownFor(r) : null;
    return {
      id: r.id, statementId: r.statement_id, account: accountName.get(r.account_id) ?? "", date: r.date, direction: r.direction,
      amount: Number(r.amount), currency: r.currency, description: r.description, counterparty: r.counterparty,
      status: r.status, matchedBy: r.matched_by, linkedTo, suggestions, template, stays: payable, known,
    };
  });

  const charges = new Map<string, number>();
  for (const r of open) if (CHARGE.test(r.description)) charges.set(r.statement_id, (charges.get(r.statement_id) ?? 0) + 1);
  const stmts: BankStatementRow[] = (statements ?? []).map((s) => ({
    id: s.id, account: accountName.get(s.account_id) ?? "", periodStart: s.period_start, periodEnd: s.period_end,
    linesAdded: s.lines_added, linesSkipped: s.lines_skipped, balanced: s.balanced, notes: s.notes, charges: charges.get(s.id) ?? 0,
  }));
  return { statements: stmts, lines: out, ...await payoutsPage(db, orgId, rows.map((r) => r.date).sort().at(-1) ?? null) };
}

/** What Airbnb sent and the bank hasn't shown yet, and stays booked from e-mails with no payout at all. */
export async function payoutsPage(db: SupabaseClient, orgId: string, lastLineDate: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  const states = await payoutStates(db, orgId, shift(today, -PAYOUTS_SINCE_DAYS));
  const expected: ExpectedPayout[] = states.filter((p) => p.stayId && !p.lineId).map((p) => {
    const due = shift(p.arrivesBy ?? shift(p.sentOn, 7), LATE_AFTER_DAYS);
    const state = due > today ? "on_its_way" : lastLineDate && lastLineDate >= due ? "late" : "no_statement_yet";
    return { key: p.key, code: p.code, guest: p.guest, sentOn: p.sentOn, arrivesBy: p.arrivesBy, received: p.received, currency: p.currency, state };
  });
  const { data: stays } = await db.from("stays").select("id, external_ref, guest_name, check_in")
    .eq("organization_id", orgId).eq("source", "email").eq("status", "confirmed")
    .lte("check_in", shift(today, -UNPAID_AFTER_DAYS)).gte("check_in", shift(today, -PAYOUTS_SINCE_DAYS));
  const withPayout = new Set(states.map((p) => p.code));
  const unpaid: UnpaidStay[] = (stays ?? []).filter((s) => !withPayout.has(s.external_ref))
    .map((s) => ({ id: s.id, code: s.external_ref, guest: s.guest_name, checkIn: s.check_in }));
  return { expected, unpaid };
}
