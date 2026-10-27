// A monthly payment (pool service, salary, internet…) whose month is missing from the books shows at the bank
// with the same amount as last month's entry. Offering to link it to that entry would be wrong; offering to
// book it "like last month" (same villa, category, description with the month changed) is one click.

export interface PastEntry {
  id: string; date: string; direction: "in" | "out"; amount: number; amountReporting: number;
  villaId: string; categoryId: string | null; category: string | null; description: string | null;
}
export interface Template { fromId: string; fromDate: string; villaId: string; categoryId: string | null; category: string | null; description: string }

/** Linking is offered for entries this close; beyond, a same-amount entry is another month's. */
export const LINK_DAYS = 14;
const MONTH_MIN = 20;
const MONTH_MAX = 40;

export function monthlyTemplate(
  line: { date: string; direction: "in" | "out"; amount: number },
  entries: PastEntry[],
): Template | null {
  const gap = (e: PastEntry) => (Date.parse(line.date) - Date.parse(e.date)) / 86_400_000;
  const same = entries.filter((e) => e.direction === line.direction
    && (e.amount === line.amount || Math.abs(e.amountReporting - line.amount) < 1));
  if (same.some((e) => Math.abs(gap(e)) <= LINK_DAYS)) return null; // this month's is there: link it instead
  // The month before if there is one, else the month after.
  const prev = same.filter((e) => gap(e) >= MONTH_MIN && gap(e) <= MONTH_MAX).sort((a, b) => gap(a) - gap(b))[0];
  const next = same.filter((e) => -gap(e) >= MONTH_MIN && -gap(e) <= MONTH_MAX).sort((a, b) => gap(b) - gap(a))[0];
  const e = prev ?? next;
  if (!e) return null;
  return {
    fromId: e.id, fromDate: e.date, villaId: e.villaId, categoryId: e.categoryId, category: e.category,
    description: retitle(e.description ?? "", e.date, line.date),
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Pool service fee — September 2026" dated in September, booked in August → "… — August 2026"; also 2026-09 and 09/2026. */
export function retitle(text: string, from: string, to: string): string {
  const [fy, fm] = [from.slice(0, 4), Number(from.slice(5, 7))];
  const [ty, tm] = [to.slice(0, 4), Number(to.slice(5, 7))];
  const long = (m: number) => MONTHS[m - 1];
  const short = (m: number) => long(m).slice(0, 3);
  const pad = (m: number) => String(m).padStart(2, "0");
  return text
    .replace(new RegExp(`\\b${long(fm)}(\\s+)${fy}\\b`, "gi"), `${long(tm)}$1${ty}`)
    .replace(new RegExp(`\\b${short(fm)}(\\s+)${fy}\\b`, "gi"), `${short(tm)}$1${ty}`)
    .replace(new RegExp(`\\b${long(fm)}\\b`, "gi"), long(tm))
    .replace(new RegExp(`\\b${fy}-${pad(fm)}\\b`, "g"), `${ty}-${pad(tm)}`)
    .replace(new RegExp(`\\b${pad(fm)}/${fy}\\b`, "g"), `${pad(tm)}/${ty}`);
}
