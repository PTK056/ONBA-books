// Monthly pay from a person's settings and the work logged for them. Self-contained (no app
// imports) so it can be tested with `node --test`.

export type PayMode = "monthly" | "hourly" | "per_job";

export interface StaffPay {
  pay_mode: PayMode;
  payday: number;
  currency: string;
  monthly_amount: number | null;
  hourly_rate: number | null;
  job_rate: number | null;
  base_unit: "visits" | "hours" | null;
  base_per_week: number | null;
  extra_rate: number | null;
}

export interface WorkLog { date: string; hours: number | null; jobs: number | null; extra_amount: number | null }

export interface PayBreakdown {
  mode: PayMode;
  currency: string;
  period: { from: string; to: string };
  fixed?: number;
  base?: { unit: "visits" | "hours"; per_week: number; this_month: number; done: number; extra_units: number; extra_rate: number };
  hours?: number;
  hourly_rate?: number;
  jobs?: number;
  job_rate?: number;
  work_amount: number;    // fixed + extras beyond the base, or hours × rate, or jobs × rate
  one_off_extras: number; // extras logged as amounts (bonus, extra shift agreed at a price)
  days_worked: number;
  total: number;
}

const round = (n: number) => Math.round(n * 100) / 100;
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/**
 * The work a month's pay covers: from the day after the previous payday to this month's payday.
 * Paid on the 25th → November's pay covers 26 October to 25 November.
 */
export function payPeriod(month: string, payday: number): { from: string; to: string; days: number } {
  const y = +month.slice(0, 4), m = +month.slice(5, 7) - 1;
  const from = iso(y, m - 1, payday + 1), to = iso(y, m, payday);
  return { from, to, days: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 };
}

/** A day of work counts as one visit unless a number of jobs is given; a log that is only an extra amount is not a visit. */
const visitsOf = (l: WorkLog) => l.jobs ?? (l.hours ? 1 : 0);

/** Pay for a month: the logs are filtered to the person's pay period here, so callers can pass a wider range. */
export function computePay(s: StaffPay, allLogs: WorkLog[], month: string): PayBreakdown {
  const period = payPeriod(month, s.payday);
  const logs = allLogs.filter((l) => l.date >= period.from && l.date <= period.to);
  const hours = round(logs.reduce((n, l) => n + (l.hours ?? 0), 0));
  const visits = logs.reduce((n, l) => n + visitsOf(l), 0);
  const oneOff = round(logs.reduce((n, l) => n + (l.extra_amount ?? 0), 0));
  const days = new Set(logs.filter((l) => l.hours || l.jobs).map((l) => l.date)).size;
  const done = (b: Omit<PayBreakdown, "period">): PayBreakdown => ({ ...b, period: { from: period.from, to: period.to }, total: round(b.work_amount + b.one_off_extras) });

  if (s.pay_mode === "hourly") {
    const rate = s.hourly_rate ?? 0;
    return done({ mode: "hourly", currency: s.currency, hours, hourly_rate: rate, work_amount: round(hours * rate), one_off_extras: oneOff, days_worked: days, total: 0 });
  }
  if (s.pay_mode === "per_job") {
    const rate = s.job_rate ?? 0;
    return done({ mode: "per_job", currency: s.currency, jobs: visits, job_rate: rate, work_amount: round(visits * rate), one_off_extras: oneOff, days_worked: days, total: 0 });
  }

  const fixed = s.monthly_amount ?? 0;
  if (!s.base_unit || !s.base_per_week) {
    return done({ mode: "monthly", currency: s.currency, fixed, work_amount: fixed, one_off_extras: oneOff, days_worked: days, total: 0 });
  }
  // Base of the period: the weekly base over its days (e.g. 3 visits/week over 31 days = 13).
  const thisMonth = Math.round((s.base_per_week * period.days) / 7);
  const realised = s.base_unit === "hours" ? hours : visits;
  const extraUnits = Math.max(0, round(realised - thisMonth));
  const extraRate = s.extra_rate ?? (thisMonth ? round(fixed / thisMonth) : 0);
  return done({
    mode: "monthly", currency: s.currency, fixed,
    base: { unit: s.base_unit, per_week: s.base_per_week, this_month: thisMonth, done: realised, extra_units: extraUnits, extra_rate: extraRate },
    work_amount: round(fixed + extraUnits * extraRate), one_off_extras: oneOff, days_worked: days, total: 0,
  });
}
