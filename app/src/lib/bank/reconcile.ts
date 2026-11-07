// What a bank line still to do most likely is, best guess first, each with a score (0 to 1) and its reasons in words.
// Looser than the automatic matching (match.ts), which only links what is certain: these are shown to a person, who
// decides with one click. Pure, so it can be tested without a database.
//
// Seen on real statements, and each covered here:
// - an entry with the same amount, paid a few days after it was booked, or weeks later (last month's pool service);
// - a Wise transfer and its fee, split by Wise into two lines, booked as one receipt with the total;
// - a transfer the bank sent back, then sent again: the two lines cancel out, nothing to book;
// - a purchase paid in several transfers (part payments of one entry);
// - a guest paying a long stay in instalments, named in the transfer.

import { days, mentions, nameFit, nameTokens, namesOf } from "./match.ts";
import { amountGap, inLineCurrency, partRoom, type EntryToScore } from "./suggest.ts";

export interface OpenLine {
  id: string; accountId: string; date: string; direction: "in" | "out"; amount: number; currency: string;
  counterparty: string | null; description: string; reference: string | null;
}

export interface BookedEntry extends EntryToScore {
  id: string; direction: "in" | "out"; category: string | null; villa: string | null;
  /** Bank lines already linked to it (part payments): their amounts. */
  paidBy: { amount: number; currency: string }[];
}

export interface StayToPay {
  id: string; guest: string | null; platform: string; checkIn: string; checkOut: string;
  /** Income minus platform fees booked for the stay, in the reporting currency. */
  net: number;
  /** What bank lines already linked to it brought, in the reporting currency. */
  paid: number;
  lines: number;
}

export type Guess =
  | { kind: "entry"; entryId: string; score: number; reasons: string[];
      /** One more payment of an entry other lines already pay in part. */
      part: boolean;
      /** Other open lines linked together with this one (its Wise fee). */
      withLines: string[] }
  | { kind: "stay"; stayId: string; score: number; reasons: string[] }
  | { kind: "cancel"; lineIds: string[]; score: number; reasons: string[] };

/** An entry may be paid weeks after it was booked (a bill paid late), or booked a few days after the payment. */
export const ENTRY_BEFORE_DAYS = 60;
export const ENTRY_AFTER_DAYS = 14;
/** A purchase paid in several transfers: over a few months. */
export const PART_BEFORE_DAYS = 120;
export const PART_AFTER_DAYS = 30;
/** A transfer sent back comes back within days. */
export const CANCEL_DAYS = 10;
/** Money in for a stay: a deposit months before arrival, an extension until just after departure. */
export const STAY_BEFORE_CHECKIN = 120;
export const STAY_AFTER_CHECKOUT = 10;
/** Amounts further apart than this are not the same money (unless the entry names the payee). */
const AMOUNT_TOLERANCE = 0.05;
const NAMED_TOLERANCE = 0.25;
const MAX_GUESSES = 5;
/** Beyond this, an entry booked before the line may be another month's (see recurring.ts). */
const LATE_DAYS = 14;
/** Guesses at or below this are offered, never shown as the first choice (the one-click button). */
export const WEAK = 0.45;

const textOf = (l: OpenLine) => [l.counterparty, l.description].filter(Boolean).join(" · ");
const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;
const dateWords = (d: number) => (d === 0 ? "same day" : d > 0 ? `booked ${d} day${d === 1 ? "" : "s"} before` : `booked ${-d} day${d === -1 ? "" : "s"} after`);
const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en", { day: "numeric", month: "short", timeZone: "UTC" });

/** The Wise fee line of a payment: Wise writes it as "<transfer id> fee", on the same day, in the same account. */
export function feeLineOf(line: OpenLine, lines: OpenLine[]): OpenLine | null {
  if (line.direction !== "out" || /^Wise fee\b/i.test(line.description)) return null;
  const sameDay = lines.filter((f) => f.id !== line.id && f.accountId === line.accountId && f.date === line.date
    && f.direction === "out" && f.currency === line.currency);
  if (line.reference) {
    const byRef = sameDay.find((f) => f.reference === `${line.reference} fee`);
    if (byRef) return byRef;
  }
  // Without a reference: "Wise fee · <payee>" naming this line's payee, and only one such fee that day.
  const named = sameDay.filter((f) => /^Wise fee\b/i.test(f.description) && mentions(f.description, nameTokens(line.counterparty ?? line.description)));
  return named.length === 1 ? named[0] : null;
}

export interface CancelGroup { lineIds: string[]; gap: number; other: OpenLine;
  /** Both lines' counterparties name the same person: evidence it is the same money back, not two payments of one amount. */
  named: boolean }

/**
 * Lines this one cancels out with: money out and the same money back within days, in the same account (with the
 * Wise fee of the payment when the refund includes it). Closest first.
 */
export function cancelGroups(line: OpenLine, lines: OpenLine[]): CancelGroup[] {
  const out: CancelGroup[] = [];
  for (const o of lines) {
    if (o.id === line.id || o.direction === line.direction || o.accountId !== line.accountId || o.currency !== line.currency) continue;
    const gap = Math.abs(days(line.date, o.date));
    if (gap > CANCEL_DAYS) continue;
    // The same amount both ways can be two unrelated payments: only a name both lines carry ties them together.
    // Counterparties only: a bank's fixed wording ("TRSF E-BANKING …") is shared by unrelated lines.
    const named = !!line.counterparty && !!o.counterparty && mentions(o.counterparty, nameTokens(line.counterparty));
    const payment = line.direction === "out" ? line : o;
    if (Math.abs(o.amount - line.amount) < 0.005) out.push({ lineIds: [line.id, o.id], gap, other: o, named });
    else {
      const fee = feeLineOf(payment, lines);
      if (fee && Math.abs(payment.amount + fee.amount - (line.direction === "out" ? o.amount : line.amount)) < 0.005) {
        out.push({ lineIds: [line.id, o.id, fee.id], gap, other: o, named });
      }
    }
  }
  return out.sort((a, b) => a.gap - b.gap);
}

/** The guesses for one line, best first (at most five). `lines` are all the lines still to do, this one included. */
export function guessLine(
  line: OpenLine, lines: OpenLine[], entries: BookedEntry[], stays: StayToPay[], reportingCurrency: string,
): Guess[] {
  const guesses: Guess[] = [];
  const named = namesOf(lines.map((l) => ({ id: l.id, text: textOf(l) })));
  const fee = feeLineOf(line, lines);

  for (const e of entries) {
    if (e.direction !== line.direction) continue;
    const fit = nameFit(e.description, line, named);
    if (fit === "other") continue;
    const d = days(e.date, line.date); // > 0: booked before the bank line
    const converted = e.currency !== line.currency;

    if (e.paidBy.length) {
      // Paid in part already: this line may be one more payment, if it fits in what is left.
      if (d > PART_BEFORE_DAYS || d < -PART_AFTER_DAYS) continue;
      const room = partRoom(line, e, e.paidBy, reportingCurrency);
      if (!room.fits || room.left === null) continue;
      const last = Math.abs(room.left - line.amount) < 0.005;
      const score = 0.1 + 0.45 * (last ? 1 : 0.4) + 0.2 * Math.max(0, 1 - Math.abs(d) / PART_BEFORE_DAYS) + (fit === "this" ? 0.25 : 0);
      // A purchase paid in parts takes any smaller line: first choice only when this line ends it or names the payee.
      guesses.push({ kind: "entry", entryId: e.id, part: true, withLines: [], score: round(last || fit === "this" ? score : Math.min(score, WEAK)), reasons: [
        `paid in part by ${e.paidBy.length} bank line${e.paidBy.length === 1 ? "" : "s"}, ${fmt(room.left)} ${line.currency} left`,
        ...(last ? ["this line pays what is left"] : []), dateWords(d), ...(fit === "this" ? ["names the payee"] : []),
      ] });
      continue;
    }

    if (d > ENTRY_BEFORE_DAYS || d < -ENTRY_AFTER_DAYS) continue;
    const compared = inLineCurrency(line, e, reportingCurrency);
    const gap = amountGap(line, compared, converted);
    if (gap === null) continue;
    // With its Wise fee, the transfer is the receipt's total.
    const withFee = fee && gap !== 0 ? amountGap({ ...line, amount: line.amount + fee.amount }, compared, converted) === 0 : false;
    const g = withFee ? 0 : gap;
    if (g > (fit === "this" ? NAMED_TOLERANCE : AMOUNT_TOLERANCE)) continue;
    const dateScore = d >= 0 ? Math.max(0, 1 - d / 30) : Math.max(0, 1 + d / ENTRY_AFTER_DAYS);
    let score = 0.55 * Math.max(0, 1 - g / AMOUNT_TOLERANCE) + 0.3 * dateScore + (fit === "this" ? 0.15 : 0);
    // Booked weeks before: a bill paid late, or last month's payment whose statement is not in yet (then this line is
    // this month's, to book "like last month"). Offered, never as the first choice.
    const late = d > LATE_DAYS;
    if (late) score = Math.min(score, WEAK);
    guesses.push({ kind: "entry", entryId: e.id, part: false, withLines: withFee ? [fee!.id] : [], score: round(score), reasons: [
      withFee ? `with its Wise fee (${fmt(fee!.amount)}), the same total`
        : g === 0 ? "same amount" : `amount differs by ${fmt(r2(Math.abs(compared! - line.amount)))} ${line.currency} (${round(g * 100, 1)}%)`,
      dateWords(d), ...(late ? ["only if no earlier bank line paid it"] : []), ...(fit === "this" ? ["names the payee"] : []),
    ] });
  }

  if (line.direction === "in" && line.currency === reportingCurrency) {
    const words = nameTokens(textOf(line));
    for (const x of stays) {
      if (days(line.date, x.checkIn) > STAY_BEFORE_CHECKIN || days(x.checkOut, line.date) > STAY_AFTER_CHECKOUT) continue;
      const guest = !!x.guest && mentions(x.guest, words);
      const left = r2(x.net - x.paid);
      const whole = Math.abs(x.net - line.amount) < 1 && x.lines === 0;
      const rest = !whole && x.lines > 0 && Math.abs(left - line.amount) < 1;
      const part = !whole && !rest && line.amount < left;
      const sinceArrival = days(x.checkIn, line.date);
      const near = sinceArrival >= -1 && sinceArrival <= 5 ? 1 : Math.max(0, 1 - Math.abs(sinceArrival) / 60);
      const score = (guest ? 0.45 : 0) + (whole || rest ? 0.4 : part ? 0.15 : 0) + 0.15 * near;
      if (score < 0.1) continue;
      guesses.push({ kind: "stay", stayId: x.id, score: round(score), reasons: [
        ...(guest ? ["the transfer names the guest"] : []),
        whole ? "same as the stay's net" : rest ? "pays what is left of the stay"
          : part ? `part of the stay (${fmt(left)} ${reportingCurrency} not paid yet)` : "amount differs from the stay's net",
        ...(x.lines ? [`${x.lines} bank line${x.lines === 1 ? "" : "s"} already pay it`] : []),
        sinceArrival === 0 ? "arrival day" : sinceArrival > 0 ? `${sinceArrival} days after arrival` : `${-sinceArrival} days before arrival`,
      ] });
    }
  }

  for (const c of cancelGroups(line, lines)) {
    // Same amount both ways, unnamed: offered first (a bank's "sent back" line rarely names anyone), but not as sure.
    guesses.push({ kind: "cancel", lineIds: c.lineIds, score: round((c.named ? 0.9 : 0.6) - 0.03 * c.gap), reasons: [
      `the same money ${c.other.direction === "in" ? "came in" : "went out"} on ${shortDay(c.other.date)}: a transfer sent back?`,
      ...(c.named ? ["both lines name the same payee"] : []),
      ...(c.lineIds.length > 2 ? ["the Wise fee came back too"] : []),
    ] });
  }

  return guesses.sort((a, b) => b.score - a.score).slice(0, MAX_GUESSES);
}

/**
 * Sets of lines that cancel out with no doubt: each line's closest set is the same set for every line in it, and no
 * other set is as close for any of them. For Sply Accountant, which proposes setting them aside together.
 */
export function cancelSets(lines: OpenLine[]): { lineIds: string[]; why: string; sure: boolean }[] {
  const best = new Map<string, CancelGroup | null>();
  for (const l of lines) {
    const gs = cancelGroups(l, lines);
    // Two sets as close (two identical lines): not sure which.
    best.set(l.id, gs.length && (gs.length === 1 || gs[1].gap > gs[0].gap) ? gs[0] : null);
  }
  const key = (ids: string[]) => [...ids].sort().join(",");
  const seen = new Set<string>();
  const out: { lineIds: string[]; why: string; sure: boolean }[] = [];
  for (const l of lines) {
    const g = best.get(l.id);
    if (!g || seen.has(key(g.lineIds))) continue;
    // The fee in a set has no set of its own; the two main lines must agree.
    const mains = g.lineIds.slice(0, 2);
    if (!mains.every((id) => best.get(id) && key(best.get(id)!.lineIds) === key(g.lineIds))) continue;
    seen.add(key(g.lineIds));
    const byId = new Map(lines.map((x) => [x.id, x]));
    const [a, b] = mains.map((id) => byId.get(id)!).sort((x, y) => x.date.localeCompare(y.date));
    out.push({ lineIds: g.lineIds, sure: g.named, why: `${fmt(a.amount)} ${a.currency} ${a.direction === "out" ? "went out" : "came in"} on ${shortDay(a.date)} `
      + `and ${b.direction === "in" ? "came back" : "went back out"} on ${shortDay(b.date)}${g.lineIds.length > 2 ? ", with the Wise fee" : ""}: `
      + `the lines cancel out, nothing to book${g.named ? "" : " (same amount; check it is the same money)"}.` });
  }
  return out;
}

/**
 * For the automatic matching: a Wise payment and its fee that together are exactly one entry not paid yet (dated up to
 * 7 days before them or 3 after, as matchLines), with no other entry as close and no other pair wanting it. Lines and
 * entries already taken by the first pass are left out.
 */
export function feePairs(
  lines: OpenLine[], entries: Omit<BookedEntry, "category" | "villa" | "paidBy">[], taken: { lines: Set<string>; entries: Set<string> },
  reportingCurrency: string,
): { lineIds: string[]; transactionId: string }[] {
  const open = lines.filter((l) => !taken.lines.has(l.id));
  const named = namesOf(open.map((l) => ({ id: l.id, text: textOf(l) })));
  const pairs: { lineIds: string[]; entryId: string; gap: number }[] = [];
  for (const l of open) {
    const fee = feeLineOf(l, open);
    if (!fee) continue;
    const total = { ...l, amount: r2(l.amount + fee.amount) };
    for (const e of entries) {
      if (taken.entries.has(e.id) || e.direction !== "out" || nameFit(e.description, l, named) === "other") continue;
      const same = e.currency === l.currency ? Math.abs(e.amount - total.amount) < 0.005
        : l.currency === reportingCurrency && amountGap(total, e.amountReporting, true) === 0;
      const d = days(e.date, l.date);
      if (same && d <= 7 && d >= -3) pairs.push({ lineIds: [l.id, fee.id], entryId: e.id, gap: Math.abs(d) });
    }
  }
  const sole = (xs: typeof pairs, p: (typeof pairs)[number]) => xs.every((y) => y === p || y.gap > p.gap);
  return pairs
    .filter((p) => sole(pairs.filter((y) => y.lineIds[0] === p.lineIds[0]), p) && sole(pairs.filter((y) => y.entryId === p.entryId), p))
    .map((p) => ({ lineIds: p.lineIds, transactionId: p.entryId }));
}

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
