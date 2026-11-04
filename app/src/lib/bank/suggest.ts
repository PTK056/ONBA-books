// How close a book entry is to a bank line, for the assistant (suggest_bank_links): a score from 0 to 1 and the
// reasons in words. Pure, so it can be tested without a database.

import { days, mentions, nameTokens } from "./match.ts";

export interface LineToMatch { date: string; amount: number; currency: string; counterparty: string | null; description: string }
export interface EntryToScore {
  date: string; amount: number; currency: string; amountReporting: number; description: string | null;
}

/** The entry's amount in the line's currency, or null when the two cannot be compared. */
export function inLineCurrency(line: LineToMatch, e: EntryToScore, reportingCurrency: string): number | null {
  if (e.currency === line.currency) return e.amount;
  return line.currency === reportingCurrency ? e.amountReporting : null;
}

/**
 * Relative gap between the amounts (0 = same). A converted amount within 0.01% (plus a cent) counts as the same:
 * the same rule as the database's check when linking (migration bank_agent).
 */
export function amountGap(line: LineToMatch, compared: number | null, converted: boolean): number | null {
  if (compared === null) return null;
  const diff = Math.abs(compared - line.amount);
  if (diff < (converted ? 0.01 + line.amount * 0.0001 : 0.005)) return 0;
  return diff / line.amount;
}

export function scoreEntry(line: LineToMatch, e: EntryToScore, reportingCurrency: string, windowDays: number) {
  const compared = inLineCurrency(line, e, reportingCurrency);
  const gap = amountGap(line, compared, e.currency !== line.currency);
  const reasons: string[] = [];
  if (gap === null) reasons.push(`in ${e.currency}, not comparable with ${line.currency}`);
  else if (gap === 0) reasons.push("same amount");
  else reasons.push(`amount differs by ${round(Math.abs(compared! - line.amount))} ${line.currency} (${round(gap * 100, 1)}%)`);

  const d = days(e.date, line.date); // > 0: entry dated before the bank line
  reasons.push(d === 0 ? "same day" : d > 0 ? `entry dated ${d}d before` : `entry dated ${-d}d after`);

  const named = mentions(e.description, nameTokens(line.counterparty ?? line.description));
  if (named) reasons.push("description names the payee");

  const amountScore = gap === null ? 0 : Math.max(0, 1 - gap / 0.05);   // 5% off or more: no credit for the amount
  const dateScore = Math.max(0, 1 - Math.abs(d) / Math.max(windowDays * 2, 1));
  const score = round(0.55 * amountScore + 0.3 * dateScore + (named ? 0.15 : 0), 2);
  return { score, reasons, gap, compared };
}

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
