// Matching bank lines with what is already in the books. Only obvious cases are linked automatically:
// same direction, same amount, close dates, and no other candidate as close. Everything else stays in
// the list for a person to decide; a wrong automatic match is worse than none.

export interface BankLineIn {
  id: string;
  date: string;            // YYYY-MM-DD
  direction: "in" | "out";
  amount: number;
  currency: string;
  /** Payee and description, to tell apart lines with the same amount. */
  text?: string;
}

export interface BookEntry {
  id: string;
  date: string;
  direction: "in" | "out";
  amount: number;          // in its own currency
  currency: string;
  amountReporting: number; // in the organization's reporting currency
  description?: string | null;
}

/** A stay's net (income minus platform fees) in the reporting currency; payoutDate when the platform export gave it. */
export interface StayNet { id: string; checkIn: string; checkOut: string; netReporting: number; payoutDate: string | null }

/** A platform payout read from its e-mail: the exact amount sent to the bank and when it should arrive. */
export interface PayoutIn { key: string; stayId: string; sentOn: string; arrivesBy: string | null; received: number }

export type Match =
  | { lineId: string; kind: "transaction"; transactionId: string }
  | { lineId: string; kind: "stays"; stayIds: string[] };

/** An entry may be dated on the invoice, a few days before it is paid, or on the day after. */
const BEFORE_DAYS = 7;
const AFTER_DAYS = 3;
/** Airbnb sends the payout on its date (or about a day after check-in); the bank shows it up to a few days later. */
const PAYOUT_DAYS = 5;
/** A payout read from its e-mail: Airbnb gives the latest arrival date; allow a few days for weekends and holidays. */
const ARRIVES_BY_SLACK = 3;
const ARRIVES_BY_DEFAULT = 7;
/**
 * A stay can be paid in instalments: a deposit when booking (weeks before arrival), the rest on arrival, an extension
 * during the stay. They arrive between INSTALMENT_BEFORE_CHECKIN days before arrival and a few days after departure.
 */
const INSTALMENT_BEFORE_CHECKIN = 90;
const INSTALMENT_AFTER_CHECKOUT = 5;
const MAX_INSTALMENTS = 3;

export function matchLines(lines: BankLineIn[], entries: BookEntry[], stays: StayNet[], reportingCurrency: string, payouts: PayoutIn[] = []): Match[] {
  type Pair = { line: BankLineIn; key: string; match: Match; gap: number };
  const pairs: Pair[] = [];
  const named = namesOf(lines);

  for (const line of lines) {
    for (const e of entries) {
      if (e.direction !== line.direction) continue;
      const fit = nameFit(e.description, line, named);
      if (fit === "other") continue;
      const same = e.currency === line.currency ? e.amount === line.amount
        : line.currency === reportingCurrency && Math.abs(e.amountReporting - line.amount) < 0.5;
      if (!same) continue;
      const gap = days(e.date, line.date); // > 0: entry dated before the bank line
      if (gap > BEFORE_DAYS || gap < -AFTER_DAYS) continue;
      // Naming this line's payee beats any date gap.
      pairs.push({ line, key: `t:${e.id}`, gap: Math.abs(gap) - (fit === "this" ? 100 : 0), match: { lineId: line.id, kind: "transaction", transactionId: e.id } });
    }
    if (line.direction === "in" && line.currency === reportingCurrency) {
      // Payouts read from e-mails: the exact amount, between the day it was sent and the day it should have arrived.
      for (const p of payouts) {
        const gap = days(p.sentOn, line.date);
        const until = (p.arrivesBy ? days(p.sentOn, p.arrivesBy) : ARRIVES_BY_DEFAULT) + ARRIVES_BY_SLACK;
        if (gap < 0 || gap > until || !near(p.received, line.amount)) continue;
        pairs.push({ line, key: `po:${p.key}`, gap, match: { lineId: line.id, kind: "stays", stayIds: [p.stayId] } });
      }
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

/** A stay still unpaid after the first pass, paid in 2 or 3 transfers: only when exactly one combination adds up. */
function instalments(lines: BankLineIn[], stays: StayNet[], done: Match[], reportingCurrency: string): Match[] {
  const usedLines = new Set(done.map((m) => m.lineId));
  const paid = new Set(done.flatMap((m) => (m.kind === "stays" ? m.stayIds : [])));
  const free = lines.filter((l) => !usedLines.has(l.id) && l.direction === "in" && l.currency === reportingCurrency);
  const found: { stay: StayNet; lines: BankLineIn[] }[] = [];
  for (const x of stays) {
    if (x.payoutDate || paid.has(x.id)) continue;
    const window = free.filter((l) => days(l.date, x.checkIn) <= INSTALMENT_BEFORE_CHECKIN && days(x.checkOut, l.date) <= INSTALMENT_AFTER_CHECKOUT);
    const options = combinations(window, MAX_INSTALMENTS).filter((c) => c.length >= 2 && near(c.reduce((s, l) => s + l.amount, 0), x.netReporting));
    if (options.length === 1) found.push({ stay: x, lines: options[0] });
  }
  // A line claimed by two stays is ambiguous: neither gets it.
  const claims = groupBy(found.flatMap((f) => f.lines.map((l) => l.id)), (id) => id);
  return found
    .filter((f) => f.lines.every((l) => claims.get(l.id)!.length === 1))
    .flatMap((f) => f.lines.map((l) => ({ lineId: l.id, kind: "stays" as const, stayIds: [f.stay.id] })));
}

/** Every subset of up to k items (a stay's window holds a handful of transfers, so this stays small). */
function combinations<T>(xs: T[], k: number): T[][] {
  const out: T[][] = [];
  const walk = (from: number, acc: T[]) => {
    if (acc.length) out.push(acc);
    if (acc.length === k) return;
    for (let i = from; i < xs.length; i++) walk(i + 1, [...acc, xs[i]]);
  };
  walk(0, []);
  return out;
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


// Names break ties: an entry that mentions the payee of one line ("… white stones, sulami") belongs to that line,
// not to another line with the same amount. Only distinctive words count: Balinese birth-order names
// (Wayan, Made, Nyoman, Ketut…) and banking words are shared by too many to tell anyone apart.
const COMMON = new Set([
  "wise", "fee", "fees", "transfer", "transfert", "card", "carte", "received", "top", "money", "sent", "via", "payment", "bank",
  "the", "and", "for", "from", "pt", "cv", "tbk", "toko", "badung", "kab", "denpasar", "bali",
  "i", "ni", "wayan", "made", "nyoman", "ketut", "putu", "kadek", "komang", "gede", "gusti", "ayu", "desak", "luh", "ngurah", "anak", "agung",
]);

/** The distinctive words of a name or a text, lowercased and without accents. */
export function nameTokens(text: string | null | undefined): string[] {
  return [...new Set((text ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z]+/).filter((w) => w.length >= 3 && !COMMON.has(w)))];
}

/** Whether a text mentions one of these distinctive words. */
export function mentions(text: string | null | undefined, tokens: string[]): boolean {
  if (!tokens.length) return false;
  const words = new Set(nameTokens(text));
  return tokens.some((t) => words.has(t));
}

/** Each line's distinctive names, and all of them together. */
export function namesOf(lines: { id: string; text?: string }[]) {
  const byLine = new Map(lines.map((l) => [l.id, nameTokens(l.text)]));
  return { byLine, all: new Set([...byLine.values()].flat()) };
}

/**
 * "this": the entry names this line's payee. "other": it names the payee of another line, not this one's,
 * so it is not this line's. "none": it names no one on the statement.
 */
export function nameFit(description: string | null | undefined, line: { id: string }, named: ReturnType<typeof namesOf>): "this" | "other" | "none" {
  const words = nameTokens(description);
  if (mentions(description, named.byLine.get(line.id) ?? [])) return "this";
  return words.some((w) => named.all.has(w)) ? "other" : "none";
}
