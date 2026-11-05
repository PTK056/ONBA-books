// Sply Accountant on its own: when it writes (weekly review on Mondays, closing of last month on the 10th, a reminder
// on the 15th), and what those messages say. Pure, so it can be tested without a database or Telegram.

import { escapeHtml, money, SIGNATURE } from "./render.ts";

export type Scheduled = "weekly" | "closing" | "closing_reminder";

/** What a day (YYYY-MM-DD, in the organization's time zone) calls for: the closing first, then the weekly review. */
export function scheduledFor(today: string): Scheduled | null {
  const day = Number(today.slice(8, 10));
  if (day === 10) return "closing";
  if (day === 15) return "closing_reminder";
  return new Date(`${today}T00:00:00Z`).getUTCDay() === 1 ? "weekly" : null;
}

const shiftDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** First day of the month before `today`'s. */
export function previousMonth(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
}

export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export const monthName = (month: string) =>
  new Date(`${month.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });

const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export interface Coverage { kind: "full" | "partial" | "none"; ranges: [string, string][] }

/** The days of a month an account's statements cover (their printed periods, merged). */
export function coverage(periods: { start: string | null; end: string | null }[], month: string): Coverage {
  const first = month, last = monthEnd(month);
  const inMonth = periods
    .filter((p): p is { start: string; end: string } => !!p.start && !!p.end && p.start <= last && p.end >= first)
    .map((p) => [p.start < first ? first : p.start, p.end > last ? last : p.end] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const ranges: [string, string][] = [];
  for (const r of inMonth) {
    const prev = ranges.at(-1);
    if (prev && r[0] <= shiftDays(prev[1], 1)) prev[1] = r[1] > prev[1] ? r[1] : prev[1];
    else ranges.push([...r]);
  }
  if (!ranges.length) return { kind: "none", ranges };
  return { kind: ranges.length === 1 && ranges[0][0] === first && ranges[0][1] === last ? "full" : "partial", ranges };
}

type Expense = { date: string; amount: number; currency: string; description: string | null };
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const expenseLine = (e: Expense) => `• ${dayMonth(e.date)} · ${money(e.amount, e.currency)}${e.description ? ` · ${escapeHtml(cut(e.description, 60))}` : ""}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface WeeklyReview {
  /** Bank lines still to do, and how many of them have a proposal waiting (sent just after, with buttons). */
  linesToDo: number; withProposal: number; questions: number;
  receiptsToReview: number;
  missingReceipts: { count: number; latest: Expense[] };
}

/** The Monday message, or null when nothing needs the owner. */
export function weeklyText(w: WeeklyReview, links: { bank: string; review: string; missing: string }): string | null {
  const withoutProposal = Math.max(0, w.linesToDo - w.withProposal);
  if (!w.linesToDo && !w.receiptsToReview && !w.missingReceipts.count) return null;
  const out = [`<b>${escapeHtml(SIGNATURE)}</b> · Weekly review`];
  if (w.withProposal) {
    const parts = [w.withProposal - w.questions && `${plural(w.withProposal - w.questions, "proposal")} to decide`, w.questions && plural(w.questions, "question")]
      .filter(Boolean).join(", ");
    out.push(`🔎 ${parts}: below, or in the <a href="${links.bank}">Bank tab</a>.`);
  }
  if (withoutProposal) out.push(`🏦 ${plural(withoutProposal, "bank line")} I could not explain: <a href="${links.bank}">Bank tab</a>.`);
  if (w.receiptsToReview) out.push(`🧾 ${plural(w.receiptsToReview, "receipt")} waiting for your review: <a href="${links.review}">Review</a>.`);
  if (w.missingReceipts.count) {
    out.push(`📎 ${plural(w.missingReceipts.count, "expense")} without a receipt. Send me the photo here and I attach it:`);
    out.push(...w.missingReceipts.latest.slice(0, 8).map(expenseLine));
    if (w.missingReceipts.count > 8) out.push(`…and ${w.missingReceipts.count - 8} more: <a href="${links.missing}">the list</a>.`);
  }
  return out.join("\n");
}

export interface ClosingReport {
  /** First day of the month to close. */
  month: string;
  accounts: { name: string; coverage: Coverage }[];
  linesToDo: number;
  receiptsToReview: number;
  missingReceipts: { count: number; latest: Expense[] };
  places: { name: string; closed: boolean }[];
}

/**
 * The closing message for last month, and whether nothing is left to do. A missing statement is only said (an account
 * may simply have had no movement): it never stops the closing. Null when every place is already closed.
 */
export function closingText(r: ClosingReport, reminder: boolean, links: { bank: string; review: string; missing: string }): { html: string; ready: boolean } | null {
  const open = r.places.filter((p) => !p.closed);
  if (!open.length) return null;
  const name = monthName(r.month);
  const todo: string[] = [];
  if (r.linesToDo) todo.push(`🏦 ${plural(r.linesToDo, "bank line")} of ${name.split(" ")[0]} still to do: <a href="${links.bank}">Bank tab</a>.`);
  if (r.receiptsToReview) todo.push(`🧾 ${plural(r.receiptsToReview, "receipt")} waiting for your review: <a href="${links.review}">Review</a>.`);
  if (r.missingReceipts.count) {
    todo.push(`📎 ${plural(r.missingReceipts.count, "expense")} of the month without a receipt (send the photo here):`);
    todo.push(...r.missingReceipts.latest.slice(0, 5).map(expenseLine));
    if (r.missingReceipts.count > 5) todo.push(`…and ${r.missingReceipts.count - 5} more: <a href="${links.missing}">the list</a>.`);
  }
  const notes = r.accounts.filter((a) => a.coverage.kind !== "full").slice(0, 8).map((a) => a.coverage.kind === "none"
    ? `• ${escapeHtml(cut(a.name, 40))}: no statement for ${name.split(" ")[0]} (fine if nothing moved).`
    : `• ${escapeHtml(cut(a.name, 40))}: statements cover ${a.coverage.ranges.map(([x, y]) => `${dayMonth(x)}–${dayMonth(y)}`).join(", ")} only.`);
  const ready = !todo.length;
  const out = [
    `<b>${escapeHtml(SIGNATURE)}</b> · ${reminder ? "Reminder: closing" : "Closing"} ${escapeHtml(name)}`,
    ready ? `✅ Nothing left to do for ${escapeHtml(name)}.` : "Left to do before closing:",
    ...todo,
    ...(notes.length ? ["", "Statements:", ...notes] : []),
    "",
    `To close: ${open.length > 6 ? `${open.length} places` : open.map((p) => escapeHtml(cut(p.name, 40))).join(", ")}. `
      + "Once closed, its entries can no longer change (reopen it in Overview if needed).",
  ];
  return { html: out.join("\n"), ready };
}

/**
 * Button data for closing a month: mc:<organization>:YYYY-MM (47 bytes, Telegram allows 64). The organization is in it so
 * an old button never closes another one's month (a chat reconnected to another account).
 */
export const closeData = (orgId: string, month: string) => `mc:${orgId}:${month.slice(0, 7)}`;
