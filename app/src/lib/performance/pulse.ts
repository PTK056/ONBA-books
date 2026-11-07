// The top of the Performance tab: one look, every day. Is the month a profit or a loss, how it compares, what is left to
// sell and the one thing to do. Built from the same facts as the reports (metrics.ts), live: no need to wait for the
// month to be closed. Pure, so it can be tested without a database.

import { addDays, addMonths, monthEnd, monthOf, type Facts, type MonthFigures } from "./metrics.ts";

export interface Pulse {
  month: string;
  /** The month is the current one: its figures still move (bookings to come, expenses to book). */
  live: boolean;
  /** Gross: what guests paid after discounts, before the platforms' fees (and any other income). */
  income: number;
  /** Every cost, the platforms' fees included. */
  expenses: number;
  /** The platforms' fees, inside `expenses`. */
  platformFees: number;
  /** Net: income − expenses. Positive, a profit; negative, a loss. */
  result: number;
  margin: number | null;
  /** Costs paid ahead and booked month by month (a lease), inside `expenses`. */
  prepaid: { names: string[]; amount: number };
  vsLastMonth: { month: string; result: number } | null;
  vsLastYear: { month: string; result: number } | null;
  /** Live month: free nights from today to the end of the month, across the villas. */
  nightsLeft: number | null;
  /** The next 30 days: share of the nights booked (blocked nights left out). */
  next30: { booked: number; available: number; share: number | null };
  nightlyRate: { now: number | null; before: number | null };
  occupancy: number | null;
  /** The first free run of 2+ nights in the next 30 days: the nights to sell first. */
  nextGap: { villa: string; start: string; end: string; nights: number } | null;
  /** The first goal, in one line: how far along. */
  goal: {
    label: string; byDate: string; target: number; cumulative: number;
    /** Share of the target made so far (null for a target of zero, such as breaking even from nothing). */
    progress: number | null;
    /** Reached (date past), or on its way by the projection; null without enough history. */
    onTrack: boolean | null;
    /** Result needed each month left, against what the last 3 months made. */
    requiredPerMonth: number | null; pace3: number | null;
  } | null;
}

export function pulse(f: Facts, today: string): Pulse {
  const cur = f.months.find((m) => m.month === f.month) ?? f.months.at(-1)!;
  const find = (m: string): MonthFigures | undefined => f.months.find((x) => x.month === m);
  const prev = find(addMonths(f.month, -1));
  const ly = find(addMonths(f.month, -12));
  const live = monthOf(today) === f.month;
  const prepaidAmount = f.prepaid.reduce((s, name) => s + (cur.byCategory[name] ?? 0), 0);

  // The calendar starts today: its first days are the rest of this month, then the next 30 days.
  const strips = f.calendar.from === today ? f.calendar.strip : [];
  const count = (days: number, mark: string) => strips.reduce((n, s) => n + [...s.days.slice(0, days)].filter((c) => c === mark).length, 0);
  const toMonthEnd = Math.max(0, Math.round((Date.parse(`${monthEnd(f.month)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) + 1);
  const booked30 = count(30, "b"), free30 = count(30, ".");

  let nextGap: Pulse["nextGap"] = null;
  for (const s of strips) {
    const m = /\.{2,}/.exec(s.days.slice(0, 30));
    if (!m) continue;
    const gap = { villa: s.villa, start: addDays(today, m.index), end: addDays(today, m.index + m[0].length), nights: m[0].length };
    if (!nextGap || gap.start < nextGap.start) nextGap = gap;
  }

  const g = f.goals[0];
  return {
    month: f.month, live,
    income: cur.income, expenses: cur.expenses, platformFees: cur.platformFees, result: cur.result,
    margin: cur.income ? cur.result / cur.income : null,
    prepaid: { names: f.prepaid.filter((n) => (cur.byCategory[n] ?? 0) > 0), amount: prepaidAmount },
    vsLastMonth: prev ? { month: prev.month, result: prev.result } : null,
    vsLastYear: ly && (ly.income || ly.expenses) ? { month: ly.month, result: ly.result } : null,
    nightsLeft: live && strips.length ? count(toMonthEnd, ".") : null,
    next30: { booked: booked30, available: booked30 + free30, share: booked30 + free30 ? booked30 / (booked30 + free30) : null },
    nightlyRate: { now: cur.adr, before: prev?.adr ?? null },
    occupancy: cur.occupancy,
    nextGap,
    goal: g ? {
      label: g.label, byDate: g.byDate, target: g.target, cumulative: g.cumulative,
      progress: g.target > 0 ? Math.max(0, Math.min(1, g.cumulative / g.target)) : null,
      onTrack: g.over ? g.reached : (g.projected ?? g.projectedAtPace) === null ? null : (g.projected ?? g.projectedAtPace)! >= g.target,
      requiredPerMonth: g.requiredPerMonth, pace3: g.pace3,
    } : null,
  };
}
