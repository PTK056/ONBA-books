// Dates as the app shows them: dd/mm/yy. Built from the ISO string, not Intl, so the
// server, the browser and the PDF print exactly the same text.

/** "2026-09-05" → "05/09/26" */
export function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
}

/** "2026-10-31", 120 → "2026-07-03" */
export function daysBefore(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

/** Today (YYYY-MM-DD) in a time zone, e.g. the organization's ("Asia/Makassar"). */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
