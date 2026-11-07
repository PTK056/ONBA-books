// A statement added again (or a later one overlapping it) must not bring its lines twice. The fingerprint (day,
// direction, amount, reference, text) catches most; but a PDF is read by Claude, and the same line may come out worded
// differently. The running balance after the line does not change: day, direction, amount and balance are the line.

export type NewLine = { date: string; direction: string; amount: number; balance: number | null; fingerprint: string };

/** The new rows that are not lines already known; each known line accounts for one new row at most. */
export function sameAsKnown<T extends NewLine>(rows: T[], known: NewLine[]): T[] {
  const prints = new Set(known.map((k) => k.fingerprint));
  const key = (x: NewLine) => `${x.date}|${x.direction}|${x.amount.toFixed(2)}|${x.balance!.toFixed(2)}`;
  const left = new Map<string, number>();
  for (const k of known) if (k.balance !== null) left.set(key(k), (left.get(key(k)) ?? 0) + 1);
  // Rows already there by fingerprint use up their own line first.
  for (const r of rows) {
    if (r.balance !== null && prints.has(r.fingerprint) && left.get(key(r))) left.set(key(r), left.get(key(r))! - 1);
  }
  return rows.filter((r) => {
    if (prints.has(r.fingerprint)) return true; // the upsert skips it, and counts it as known
    if (r.balance === null || !left.get(key(r))) return true;
    left.set(key(r), left.get(key(r))! - 1);
    return false;
  });
}

