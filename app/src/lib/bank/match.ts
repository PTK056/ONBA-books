// Matching bank lines with what is already in the books. Only obvious cases are linked automatically:
// same direction, same amount, close dates, and no other candidate as close. Everything else stays in
// the list for a person to decide; a wrong automatic match is worse than none.

export interface BankLineIn {
  id: string;
  date: string;            // YYYY-MM-DD
  direction: "in" | "out";
  amount: number;
  currency: string;
}

export interface BookEntry {
  id: string;
  date: string;
  direction: "in" | "out";
  amount: number;          // in its own currency
  currency: string;
  amountReporting: number; // in the organization's reporting currency
}

/** A stay's net (income minus platform fees) in the reporting currency; payoutDate when the platform export gave it. */
export interface StayNet { id: string; checkIn: string; checkOut: string; netReporting: number; payoutDate: string | null }

export type Match =
  | { lineId: string; kind: "transaction"; transactionId: string }
  | { lineId: string; kind: "stays"; stayIds: string[] };

/** An entry may be dated on the invoice, a few days before it is paid, or on the day after. */
const BEFORE_DAYS = 7;
const AFTER_DAYS = 3;
/** Airbnb sends the payout on its date (or about a day after check-in); the bank shows it up to a few days later. */
const PAYOUT_DAYS = 5;
/** A long stay can be paid in instalments; the last one arrives by a few days after check-out. */
const INSTALMENT_AFTER_CHECKOUT = 5;

export function matchLines(lines: BankLineIn[], entries: BookEntry[], stays: StayNet[], reportingCurrency: string): Match[] {
  type Pair = { line: BankLineIn; key: string; match: Match; gap: number };
  const pairs: Pair[] = [];

  for (const line of lines) {
    for (const e of entries) {
      if (e.direction !== line.direction) continue;
      const same = e.currency === line.currency ? e.amount === line.amount
        : line.currency === reportingCurrency && Math.abs(e.amountReporting - line.amount) < 0.5;
      if (!same) continue;
      const gap = days(e.date, line.date); // > 0: entry dated before the bank line
      if (gap > BEFORE_DAYS || gap < -AFTER_DAYS) continue;
      pairs.push({ line, key: `t:${e.id}`, gap: Math.abs(gap), match: { lineId: line.id, kind: "transaction", transactionId: e.id } });
    }
    if (line.direction === "in" && line.currency === reportingCurrency) {
      // Stays the export gave a payout date: one transfer pays all the stays of that date.
      for (const [date, group] of groupBy(stays.filter((x) => x.payoutDate), (x) => x.payoutDate!)) {
        const gap = days(date, line.date);
        if (gap < 0 || gap > PAYOUT_DAYS || !near(sum(group), line.amount)) continue;
        pairs.push({ line, key: `p:${date}`, gap, match: { lineId: line.id, kind: "stays", stayIds: group.map((x) => x.id) } });
      }
      // Otherwise one stay, paid shortly after check-in.
      for (const x of stays.filter((x) => !x.payoutDate)) {
        const gap = days(x.checkIn, line.date);
        if (gap < -1 || gap > PAYOUT_DAYS || !near(x.netReporting, line.amount)) continue;
        pairs.push({ line, key: `s:${x.id}`, gap: Math.abs(gap), match: { lineId: line.id, kind: "stays", stayIds: [x.id] } });
      }
    }
  }

  // Unambiguous only: the line's closest candidate must be unique, and that candidate's closest line too.
  const byLine = groupBy(pairs, (p) => p.line.id);
  const byKey = groupBy(pairs, (p) => p.key);
  const out: Match[] = [];
  for (const p of pairs) {
    if (!isSoleBest(byLine.get(p.line.id)!, p) || !isSoleBest(byKey.get(p.key)!, p)) continue;
    out.push(p.match);
  }
  return [...out, ...instalments(lines, stays, out, reportingCurrency)];
}

/** A stay still unpaid after the first pass, paid in two transfers: only when exactly one pair of lines adds up. */
function instalments(lines: BankLineIn[], stays: StayNet[], done: Match[], reportingCurrency: string): Match[] {
  const usedLines = new Set(done.map((m) => m.lineId));
  const paid = new Set(done.flatMap((m) => (m.kind === "stays" ? m.stayIds : [])));
  const free = lines.filter((l) => !usedLines.has(l.id) && l.direction === "in" && l.currency === reportingCurrency);
  const found: { stay: StayNet; a: BankLineIn; b: BankLineIn }[] = [];
  for (const x of stays) {
    if (x.payoutDate || paid.has(x.id)) continue;
    const window = free.filter((l) => days(x.checkIn, l.date) >= -1 && days(x.checkOut, l.date) <= INSTALMENT_AFTER_CHECKOUT);
    const options: { a: BankLineIn; b: BankLineIn }[] = [];
    for (const a of window) {
      const gap = days(x.checkIn, a.date);
      if (gap < -1 || gap > PAYOUT_DAYS) continue; // the first instalment comes right after check-in
      for (const b of window) if (b !== a && b.date >= a.date && near(a.amount + b.amount, x.netReporting)) options.push({ a, b });
    }
    if (options.length === 1) found.push({ stay: x, ...options[0] });
  }
  // A line claimed by two stays is ambiguous: neither gets it.
  const claims = groupBy(found.flatMap((f) => [f.a.id, f.b.id]), (id) => id);
  return found
    .filter((f) => claims.get(f.a.id)!.length === 1 && claims.get(f.b.id)!.length === 1)
    .flatMap((f) => [f.a, f.b].map((l) => ({ lineId: l.id, kind: "stays" as const, stayIds: [f.stay.id] })));
}

const sum = (xs: StayNet[]) => xs.reduce((s, x) => s + x.netReporting, 0);
const near = (a: number, b: number) => Math.abs(a - b) < 1;

function isSoleBest<T extends { gap: number }>(xs: T[], x: T) {
  return xs.every((y) => y === x || y.gap > x.gap);
}

function groupBy<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

/** Whole days from a to b (b - a). */
export function days(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
