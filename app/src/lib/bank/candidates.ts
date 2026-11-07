import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BankError } from "./errors";
import { shift } from "./ops";
import { payoutStates } from "./payouts";
import { nameTokens } from "./match";
import { STAY_AFTER_CHECKOUT, STAY_BEFORE_CHECKIN } from "./reconcile";
import { partRoom, scoreEntry } from "./suggest";

// What a bank line still to do could be: entries already in the books, and for money in the stays it could pay.
// Shared by the assistant's suggest_bank_links tool and Sply Accountant's dossiers.

export interface LineToExplain {
  date: string; direction: "in" | "out"; amount: number; currency: string; counterparty: string | null; description: string;
}

export interface EntryCandidate {
  transactionId: string; date: string; amount: number; currency: string; description: string | null;
  category: string | null; villa: string | null; score: number; reasons: string[];
  /** Relative amount gap (0 = same money; null = currencies that cannot be compared). */
  gap: number | null;
  /** Already paid in part by other bank lines (with `parts`): how many, and what is left in the line's currency. */
  paidBy: { lines: number; left: number | null } | null;
}

export interface StayCandidate {
  stayId: string; reference: string | null; guest: string | null; platform: string; checkIn: string; checkOut: string;
  /** Income minus platform fees booked for the stay, in the reporting currency. */
  netBooked: number;
  linesAlreadyLinked: number;
  payoutEmail: { amount: number; currency: string; sentOn: string; arrivesBy: string | null } | null;
}

const num = (x: unknown) => Number(x);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Rows of `table` in the organization whose `column` is one of `ids`, asked 100 at a time (a long list overflows the URL). */
export async function whereIn<T>(
  db: SupabaseClient, orgId: string, table: string, fields: string, column: string, ids: string[],
  extra?: (q: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    let q = db.from(table).select(fields).eq("organization_id", orgId).in(column, ids.slice(i, i + 100));
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw new BankError("failed", "Could not load the books. Try again.");
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

/**
 * Booked entries that could be this line: same direction, not a stay's income, not linked to another bank line (with
 * `parts`, or paid in part by others with room left for this one), within the window, amount within the tolerance (any
 * amount when searching words). Best first, at most `limit`.
 */
export async function entryCandidates(
  db: SupabaseClient, orgId: string, reportingCurrency: string, line: LineToExplain,
  opts: { windowDays?: number; /** Further back than windowDays: a bill paid weeks after it was booked. */ beforeDays?: number;
    tolerancePct?: number; text?: string; limit?: number; parts?: boolean } = {},
): Promise<EntryCandidate[]> {
  const windowDays = opts.windowDays ?? 10;
  const beforeDays = Math.max(opts.beforeDays ?? windowDays, windowDays);
  const tolerance = (opts.tolerancePct ?? 0) / 100;
  const words = opts.text?.replace(/[%_,()*]/g, " ").trim();
  let q = db.from("transactions")
    .select("id, date, amount, currency, amount_reporting, description, villa:villas (name), category:categories (name)")
    .eq("organization_id", orgId).eq("status", "validated").eq("direction", line.direction).is("stay_id", null)
    .gte("date", shift(line.date, words ? -90 : -beforeDays)).lte("date", shift(line.date, words ? 30 : windowDays)).limit(300);
  if (words) q = q.ilike("description", `%${words}%`);
  const { data, error } = await q;
  // Never "nothing matches" because a search failed: that would lead to booking the same money twice.
  if (error) throw new BankError("failed", "Could not search the books. Try again before adding anything.");
  type Tx = { id: string; date: string; amount: number; currency: string; amount_reporting: number; description: string | null;
    villa: { name: string } | null; category: { name: string } | null };
  const list = (data ?? []) as unknown as Tx[];
  const taken = await whereIn<{ transaction_id: string; amount: number; currency: string }>(
    db, orgId, "bank_lines", "transaction_id, amount, currency", "transaction_id", list.map((t) => t.id));
  const paidBy = new Map<string, { amount: number; currency: string }[]>();
  for (const x of taken) paidBy.set(x.transaction_id, [...(paidBy.get(x.transaction_id) ?? []), { amount: num(x.amount), currency: x.currency }]);
  type Paid = { lines: number; left: number | null } | null;
  return list.flatMap((t) => {
    const e = { date: t.date, amount: num(t.amount), currency: t.currency, amountReporting: num(t.amount_reporting), description: t.description };
    const paid = paidBy.get(t.id);
    if (!paid) return [{ t, paid: null as Paid, ...scoreEntry(line, e, reportingCurrency, windowDays) }];
    // Linked already: only as one more payment of it, when asked for and when this line fits in what is left.
    const room = opts.parts ? partRoom(line, e, paid, reportingCurrency) : null;
    if (!room?.fits || room.left === null) return [];
    // Scored and filtered against what is left to pay, in the line's currency: the last payment is the same money.
    const rest = { ...e, currency: line.currency, amount: room.left, amountReporting: room.left };
    const scored = scoreEntry(line, rest, reportingCurrency, windowDays);
    return [{ t, paid: { lines: paid.length, left: room.left } as Paid, ...scored,
      reasons: [`paid in part by ${paid.length} bank line${paid.length === 1 ? "" : "s"}, ${room.left} ${line.currency} left`, ...scored.reasons] }];
  }).filter((x) => words || (x.gap !== null && x.gap <= tolerance + 1e-9))
    .sort((x, y) => y.score - x.score).slice(0, opts.limit ?? 10)
    .map(({ t, paid, score, reasons, gap }) => ({
      transactionId: t.id, date: t.date, amount: num(t.amount), currency: t.currency, description: t.description,
      category: t.category?.name ?? null, villa: t.villa?.name ?? null, score, reasons, gap, paidBy: paid,
    }));
}

/** For money in: the stays it could pay (arrival within 90 days after it, departure up to 5 days before), and payouts announced by e-mail. */
export async function stayCandidates(db: SupabaseClient, orgId: string, line: LineToExplain): Promise<StayCandidate[]> {
  if (line.direction !== "in") return [];
  // A guest paying a stay themselves (a deposit, instalments) is named in the transfer: their stays come first.
  const names = nameTokens(line.counterparty ?? line.description).slice(0, 3);
  const [{ data: around, error }, payouts, { data: named, error: namedError }] = await Promise.all([
    db.from("stays").select("id, check_in")
      .eq("organization_id", orgId).gte("check_out", shift(line.date, -5)).lte("check_in", shift(line.date, 90)).limit(200),
    payoutStates(db, orgId, shift(line.date, -30)),
    names.length
      ? db.from("stays").select("id").eq("organization_id", orgId).or(names.map((n) => `guest_name.ilike.%${n}%`).join(","))
        .gte("check_out", shift(line.date, -STAY_AFTER_CHECKOUT)).lte("check_in", shift(line.date, STAY_BEFORE_CHECKIN)).limit(3)
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
  ]);
  if (error || namedError) throw new BankError("failed", "Could not search the stays. Try again before adding anything.");
  const pending = payouts.filter((p) => p.stayId && !p.lineId && p.sentOn <= line.date && shift(p.sentOn, 15) >= line.date);
  const closest = (around ?? [])
    .sort((x, y) => Math.abs(Date.parse(x.check_in) - Date.parse(line.date)) - Math.abs(Date.parse(y.check_in) - Date.parse(line.date)));
  const ids = [...new Set([...(named ?? []).map((x) => x.id), ...pending.map((p) => p.stayId!), ...closest.slice(0, 5).map((x) => x.id)])].slice(0, 8);
  if (!ids.length) return [];
  const [info, incomes, links] = await Promise.all([
    whereIn<{ id: string; external_ref: string | null; guest_name: string | null; platform: string; check_in: string; check_out: string }>(
      db, orgId, "stays", "id, external_ref, guest_name, platform, check_in, check_out", "id", ids),
    whereIn<{ stay_id: string; direction: string; amount_reporting: number }>(
      db, orgId, "transactions", "stay_id, direction, amount_reporting", "stay_id", ids, (q) => q.eq("status", "validated")),
    whereIn<{ stay_id: string }>(db, orgId, "bank_line_stays", "stay_id", "stay_id", ids),
  ]);
  // In the order of ids: the guest's own stays first, then announced payouts, then the closest arrivals.
  const order = new Map(ids.map((id, i) => [id, i]));
  return info.sort((a, b) => order.get(a.id)! - order.get(b.id)!).map((x) => {
    const payout = pending.find((p) => p.stayId === x.id);
    return {
      stayId: x.id, reference: x.external_ref, guest: x.guest_name, platform: x.platform, checkIn: x.check_in, checkOut: x.check_out,
      netBooked: r2(incomes.filter((t) => t.stay_id === x.id).reduce((n, t) => n + (t.direction === "in" ? 1 : -1) * num(t.amount_reporting), 0)),
      linesAlreadyLinked: links.filter((k) => k.stay_id === x.id).length,
      payoutEmail: payout ? { amount: payout.received, currency: payout.currency, sentOn: payout.sentOn, arrivesBy: payout.arrivesBy } : null,
    };
  });
}

/** Whether a transfer is the money of these stays: their net, or the payouts Airbnb announced (same rule as linking an entry). */
export function staysFit(line: LineToExplain, reportingCurrency: string, net: number, announced: number): boolean {
  const tolerance = 0.01 + line.amount * 0.0001;
  return (line.currency === reportingCurrency && Math.abs(net - line.amount) < tolerance)
    || (announced > 0 && Math.abs(announced - line.amount) < tolerance);
}

export const RATE_MAX_AGE_DAYS = 45;

/**
 * The rate from `currency` to the reporting currency used closest to `date`, within RATE_MAX_AGE_DAYS on either side;
 * null when there is none (then a person gives it).
 */
export async function nearestRate(
  db: SupabaseClient, orgId: string, currency: string, date: string,
): Promise<{ rate: number; date: string } | null> {
  const base = () => db.from("transactions").select("fx_rate, date").eq("organization_id", orgId).eq("currency", currency);
  const [before, after] = await Promise.all([
    base().lte("date", date).gte("date", shift(date, -RATE_MAX_AGE_DAYS)).order("date", { ascending: false }).limit(1),
    base().gt("date", date).lte("date", shift(date, RATE_MAX_AGE_DAYS)).order("date", { ascending: true }).limit(1),
  ]);
  if (before.error || after.error) throw new BankError("failed", "Could not look up the exchange rate. Try again.");
  const gap = (d: string) => Math.abs(Date.parse(d) - Date.parse(date));
  const best = [before.data?.[0], after.data?.[0]].filter((x): x is { fx_rate: number; date: string } => !!x)
    .sort((x, y) => gap(x.date) - gap(y.date))[0];
  return best ? { rate: Number(best.fx_rate), date: best.date } : null;
}
