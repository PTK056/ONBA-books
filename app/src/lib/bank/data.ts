import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { whereIn } from "./candidates";
import { guessLine, PART_BEFORE_DAYS, PART_AFTER_DAYS, STAY_AFTER_CHECKOUT, STAY_BEFORE_CHECKIN, WEAK, type BookedEntry, type OpenLine, type StayToPay } from "./reconcile";
import { listProposals } from "./accountant/views";
import type { ProposalView } from "./accountant/render";
import { payeeKey } from "./payees";
import { CHARGE, shift } from "./ops";
import { payoutStates } from "./payouts";
import { monthlyTemplate, retitle, type PastEntry, type Template } from "./recurring";

export interface BankStatementRow {
  id: string; account: string; periodStart: string | null; periodEnd: string | null;
  linesAdded: number; linesSkipped: number; balanced: boolean | null; notes: string | null; charges: number;
}
/**
 * What a line still to do most likely is (lib/bank/reconcile), best first, with the reasons in words. `first`: strong
 * enough to be the one-click button; the others wait behind More.
 */
export type GuessView = { score: number; reasons: string[]; first: boolean } & (
  | { kind: "entry"; id: string; date: string; label: string; amount: number; currency: string; part: boolean;
      /** Other lines linked with it: its Wise fee. */
      withLines: { id: string; amount: number }[] }
  | { kind: "stay"; id: string; guest: string | null; platform: string; checkIn: string; checkOut: string }
  | { kind: "cancel"; lineIds: string[]; others: { date: string; direction: "in" | "out"; amount: number }[] }
);
export interface BankLineRow {
  id: string; statementId: string; account: string; date: string; direction: "in" | "out"; amount: number; currency: string;
  description: string; counterparty: string | null; status: "unmatched" | "matched" | "personal"; matchedBy: string | null;
  /** Who handled it (auto, app, agent: the assistant), with its note and, for a personal line, the reason. */
  handledVia: "auto" | "app" | "agent" | null; note: string | null; personalReason: string | null;
  /** The owner's own note, on any line. */
  ownNote: string | null;
  /** Still not in the books, but set aside by the owner: out of the list to do. */
  setAside: boolean;
  /** What the line is linked to, in words. */
  linkedTo: string | null;
  guesses: GuessView[];
  /** A monthly payment whose month is missing: book it like the neighbouring month's entry. */
  template: Template | null;
  /** A regular payee: where their last payment was booked. */
  known: KnownPayee | null;
  /** What Sply Accountant proposes for it, waiting for OK or Decline. */
  proposal: ProposalView | null;
}
export interface KnownPayee {
  villaId: string; villa: string; categoryId: string | null; category: string | null; description: string | null; uses: number;
}
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

export async function bankPage(db: SupabaseClient, orgId: string, reportingCurrency: string) {
  const [{ data: accounts }, { data: statements }, { data: lines }, knownFor, proposals] = await Promise.all([
    db.from("bank_accounts").select("id, name, last4").eq("organization_id", orgId),
    db.from("bank_statements")
      .select("id, account_id, period_start, period_end, lines_added, lines_skipped, balanced, notes")
      .eq("organization_id", orgId).order("period_start", { ascending: false }),
    db.from("bank_lines")
      .select("id, statement_id, account_id, date, direction, amount, currency, description, counterparty, reference, payee_last4, status, matched_by, "
        + "transaction_id, handled_via, handled_note, personal_reason, note, set_aside_at, "
        + "transaction:transactions (date, description, category:categories (name)), stays:bank_line_stays (stay:stays (external_ref, guest_name, check_in))")
      .eq("organization_id", orgId).order("date", { ascending: false }).limit(1000),
    payeeMemory(db, orgId),
    listProposals(db, orgId, { pending: true }),
  ]);
  const proposalOf = new Map(proposals.map((p) => [p.lineId, p]));
  const accountName = new Map((accounts ?? []).map((a) => [a.id, a.last4 ? `${a.name} ••••${a.last4}` : a.name]));

  type Row = {
    id: string; statement_id: string; account_id: string; date: string; direction: "in" | "out"; amount: number; currency: string;
    description: string; counterparty: string | null; reference: string | null; payee_last4: string | null; status: BankLineRow["status"];
    matched_by: string | null; transaction_id: string | null; handled_via: BankLineRow["handledVia"]; handled_note: string | null;
    personal_reason: string | null; note: string | null; set_aside_at: string | null;
    transaction: { date: string; description: string | null; category: { name: string } | null } | null;
    stays: { stay: { external_ref: string | null; guest_name: string | null; check_in: string } }[];
  };
  const rows = (lines ?? []) as unknown as Row[];
  // Lines paying one entry together: a purchase paid in several transfers (bank charges booked together are one entry).
  const payments = new Map<string, number>();
  for (const r of rows) if (r.transaction_id && r.matched_by !== "created") payments.set(r.transaction_id, (payments.get(r.transaction_id) ?? 0) + 1);

  // Entries around the unmatched lines: to link one (with what other lines already pay of it), or to copy last month's.
  const open = rows.filter((r) => r.status === "unmatched");
  const around: (PastEntry & { currency: string; villa: string | null; paidBy: BookedEntry["paidBy"] })[] = [];
  let stays: StayToPay[] = [];
  if (open.length) {
    const dates = open.map((r) => r.date).sort();
    // Page by page (the API returns at most 1000 rows at once): an entry missed here could be added a second time.
    const txs: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("transactions")
        .select("id, date, direction, amount, currency, amount_reporting, villa_id, category_id, description, category:categories (name), villa:villas (name)")
        .eq("organization_id", orgId).eq("status", "validated").is("stay_id", null)
        .gte("date", shift(dates[0], -Math.max(AROUND_DAYS, PART_BEFORE_DAYS))).lte("date", shift(dates.at(-1)!, Math.max(AROUND_DAYS, PART_AFTER_DAYS)))
        .order("id").range(from, from + 999);
      if (error) throw new Error(`transactions: ${error.message}`);
      txs.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    type Tx = { id: string; date: string; direction: "in" | "out"; amount: number; currency: string; amount_reporting: number; villa_id: string;
      category_id: string | null; description: string | null; category: { name: string } | null; villa: { name: string } | null };
    const list = txs as Tx[];
    const taken = await whereIn<{ transaction_id: string; amount: number; currency: string }>(
      db, orgId, "bank_lines", "transaction_id, amount, currency", "transaction_id", list.map((t) => t.id));
    const paidBy = new Map<string, BookedEntry["paidBy"]>();
    for (const x of taken) paidBy.set(x.transaction_id, [...(paidBy.get(x.transaction_id) ?? []), { amount: Number(x.amount), currency: x.currency }]);
    around.push(...list.map((t) => ({
      id: t.id, date: t.date, direction: t.direction, amount: Number(t.amount), currency: t.currency, amountReporting: Number(t.amount_reporting),
      villaId: t.villa_id, villa: t.villa?.name ?? null, categoryId: t.category_id, category: t.category?.name ?? null, description: t.description,
      paidBy: paidBy.get(t.id) ?? [],
    })));

    // Stays an incoming transfer could pay: a deposit months before arrival, the balance, an extension.
    const incoming = open.filter((r) => r.direction === "in").map((r) => r.date).sort();
    if (incoming.length) {
      const { data } = await db.from("stays").select("id, guest_name, platform, check_in, check_out")
        .eq("organization_id", orgId).gte("check_out", shift(incoming[0], -STAY_AFTER_CHECKOUT))
        .lte("check_in", shift(incoming.at(-1)!, STAY_BEFORE_CHECKIN)).limit(1000);
      const ids = (data ?? []).map((x) => x.id);
      const [incomes, links] = await Promise.all([
        whereIn<{ stay_id: string; direction: string; amount_reporting: number }>(
          db, orgId, "transactions", "stay_id, direction, amount_reporting", "stay_id", ids, (q) => q.eq("status", "validated")),
        whereIn<{ stay_id: string; line: { amount: number } | null }>(db, orgId, "bank_line_stays", "stay_id, line:bank_lines (amount)", "stay_id", ids),
      ]);
      stays = (data ?? []).map((x) => {
        const mine = links.filter((k) => k.stay_id === x.id);
        return {
          id: x.id, guest: x.guest_name, platform: x.platform, checkIn: x.check_in, checkOut: x.check_out,
          net: incomes.filter((t) => t.stay_id === x.id).reduce((n, t) => n + (t.direction === "in" ? 1 : -1) * Number(t.amount_reporting), 0),
          paid: mine.reduce((n, k) => n + Number(k.line?.amount ?? 0), 0), lines: mine.length,
        };
      });
    }
  }
  const openLines: OpenLine[] = open.map((r) => ({
    id: r.id, accountId: r.account_id, date: r.date, direction: r.direction, amount: Number(r.amount), currency: r.currency,
    counterparty: r.counterparty, description: r.description, reference: r.reference,
  }));
  const openById = new Map(openLines.map((l) => [l.id, l]));
  const entryById = new Map(around.map((e) => [e.id, e]));
  const stayById = new Map(stays.map((x) => [x.id, x]));

  const viewOf = (g: ReturnType<typeof guessLine>[number]): GuessView => {
    const base = { score: g.score, reasons: g.reasons, first: g.score > WEAK };
    if (g.kind === "entry") {
      const e = entryById.get(g.entryId)!;
      return { ...base, kind: "entry", id: e.id, date: e.date, amount: e.amount, currency: e.currency, part: g.part,
        label: [e.category, e.description].filter(Boolean).join(" · ") || "An entry",
        withLines: g.withLines.map((id) => ({ id, amount: openById.get(id)!.amount })) };
    }
    if (g.kind === "stay") {
      const x = stayById.get(g.stayId)!;
      return { ...base, kind: "stay", id: x.id, guest: x.guest, platform: x.platform, checkIn: x.checkIn, checkOut: x.checkOut };
    }
    return { ...base, kind: "cancel", lineIds: g.lineIds,
      others: g.lineIds.slice(1).map((id) => openById.get(id)!).map((l) => ({ date: l.date, direction: l.direction, amount: l.amount })) };
  };

  const out: BankLineRow[] = rows.map((r) => {
    const linkedStays = r.stays.map((x) => x.stay);
    const parts = r.transaction_id && r.matched_by !== "created" ? payments.get(r.transaction_id) ?? 0 : 0;
    const linkedTo = r.transaction
      ? ([r.transaction.category?.name, r.transaction.description].filter(Boolean).join(" · ") || "An entry")
        + (parts > 1 ? ` (one of ${parts} payments)` : "")
      : linkedStays.length ? `Airbnb ${linkedStays.map((x) => x.external_ref ?? x.check_in).join(", ")}` : null;
    const todo = r.status === "unmatched";
    const line = { date: r.date, direction: r.direction, amount: Number(r.amount) };
    const template = todo ? monthlyTemplate(line, around) : null;
    return {
      id: r.id, statementId: r.statement_id, account: accountName.get(r.account_id) ?? "", date: r.date, direction: r.direction,
      amount: Number(r.amount), currency: r.currency, description: r.description, counterparty: r.counterparty,
      status: r.status, matchedBy: r.matched_by, handledVia: r.handled_via, note: r.handled_note, personalReason: r.personal_reason,
      ownNote: r.note, setAside: todo && !!r.set_aside_at, linkedTo, proposal: todo ? proposalOf.get(r.id) ?? null : null,
      guesses: todo ? guessLine(openById.get(r.id)!, openLines, around, stays, reportingCurrency).map(viewOf) : [],
      template, known: todo ? knownFor(r) : null,
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

/** Regular payees: for a bank line, where the last payment to (or from) the same payee was booked; null if unknown. */
export async function payeeMemory(db: SupabaseClient, orgId: string) {
  const [{ data: payees }, { data: villas }, { data: cats }] = await Promise.all([
    db.from("bank_payees").select("key, direction, villa_id, category_id, description, uses, last_used").eq("organization_id", orgId),
    db.from("villas").select("id, name").eq("organization_id", orgId),
    db.from("categories").select("id, name").eq("organization_id", orgId),
  ]);
  const villaName = new Map((villas ?? []).map((v) => [v.id, v.name]));
  const catName = new Map((cats ?? []).map((c) => [c.id, c.name]));
  const memory = new Map((payees ?? []).filter((p) => p.villa_id).map((p) => [`${p.key}|${p.direction}`, p]));
  return (r: { date: string; direction: string; description: string; counterparty: string | null; payee_last4: string | null }): KnownPayee | null => {
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
