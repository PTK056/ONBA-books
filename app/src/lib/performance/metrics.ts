// Sply Performance: every figure of a report, computed here and only here (Claude explains them, never makes one).
// Pure, so it can be tested without a database: lib/performance/report loads the rows and calls facts().
//
// Money is in the organization's reporting currency (the entries' amount_reporting). A month is YYYY-MM-01.
// Income and expenses are the validated entries; nights come from the stays (a refunded stay sells none) and the
// blocked nights (the owner's own stays, works), which are not for sale.

export const ENGINE = 1;

export interface Place { id: string; name: string; kind: "villa" | "company" }
export interface Entry {
  date: string; placeId: string; direction: "in" | "out"; amount: number;
  /** 'stay' for the lines a stay writes (its income and the platform's fee). */
  source: string;
  category: string | null;
  /** The stay's platform, for a stay's lines. */
  platform: string | null;
}
export interface StayRow {
  placeId: string; checkIn: string; checkOut: string; platform: string;
  /** Net under 5% of gross: refunded, sells no night (as in Overview). */
  refunded: boolean;
  /** When the booking was made, when known (stays read from the platform's e-mails). */
  bookedOn: string | null;
}
export interface Block { placeId: string; start: string; end: string; reason: "owner" | "works" | "other" }
export interface Goal {
  id: string; label: string; placeId: string | null; since: string; byDate: string;
  target: number; invested: number | null; planned: number; plannedNote: string | null;
}
export interface Data { places: Place[]; entries: Entry[]; stays: StayRow[]; blocks: Block[]; goals: Goal[] }

export type Unit = "money" | "percent" | "nights" | "days" | "count" | "months" | "ratio";
export interface Metric { label: string; value: number | null; unit: Unit }

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(ms(d) + n * DAY);
export const monthOf = (d: string) => `${d.slice(0, 7)}-01`;
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return iso(Date.UTC(y, m - 1 + n, 1));
}
export const monthEnd = (month: string) => addDays(addMonths(month, 1), -1);
/** Whole months from the month after `from` to the month of `to`, both included (0 if `to` is not later). */
export function monthsBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((d) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)));
  return Math.max(0, b - a);
}
const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);

/** A safe key part from a name: "Cleaning / Freelance" → "cleaning_freelance". */
export const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "other";

// ---------------------------------------------------------------------------
// One month
// ---------------------------------------------------------------------------

export interface MonthFigures {
  month: string;
  /** Nights the villas could be sold: from their first booked night, less the blocked nights. */
  available: number;
  blocked: number;
  sold: number;
  occupancy: number | null;
  /** Stay income per night sold. */
  adr: number | null;
  /** Stay income per night available. */
  revpar: number | null;
  stayIncome: number;
  income: number;
  platformFees: number;
  expenses: number;
  result: number;
  /** The result before the costs paid ahead and booked month by month (e.g. a lease): what the month itself made. */
  operating: number;
  byCategory: Record<string, number>;
  stays: number;
  avgLength: number | null;
  /** Days between booking and arrival, on average, for the stays whose booking date is known. */
  leadDays: number | null;
  channels: Record<string, { nights: number; income: number }>;
}

interface Ctx {
  scope: Set<string>;
  villas: Place[];
  opened: Map<string, string>;
  /** Categories of the costs paid ahead (booked into months not yet come); see prepaidCategories. */
  prepaid: Set<string>;
}

function nightsIn(start: string, end: string, from: string, to: string): string[] {
  const out: string[] = [];
  const a = Math.max(ms(start), ms(from)), b = Math.min(ms(end), ms(to));
  for (let t = a; t < b; t += DAY) out.push(iso(t));
  return out;
}

export function monthFigures(month: string, d: Data, c: Ctx): MonthFigures {
  const from = month, to = addMonths(month, 1);
  let available = 0, blocked = 0, sold = 0;
  const channels: Record<string, { nights: number; income: number }> = {};
  for (const v of c.villas) {
    const opened = c.opened.get(v.id);
    if (!opened || opened >= to) continue;
    const start = opened > from ? opened : from;
    const days = new Set(nightsIn(start, to, start, to));
    const soldDays = new Set<string>();
    for (const s of d.stays) {
      if (s.placeId !== v.id || s.refunded) continue;
      for (const n of nightsIn(s.checkIn, s.checkOut, from, to)) {
        if (soldDays.has(n)) continue;
        soldDays.add(n);
        (channels[s.platform] ??= { nights: 0, income: 0 }).nights++;
      }
    }
    const blockedDays = new Set<string>();
    for (const b of d.blocks) if (b.placeId === v.id) for (const n of nightsIn(b.start, b.end, start, to)) if (!soldDays.has(n)) blockedDays.add(n);
    available += days.size - blockedDays.size;
    blocked += blockedDays.size;
    sold += soldDays.size;
  }

  let stayIncome = 0, income = 0, platformFees = 0, expenses = 0, prepaid = 0;
  const byCategory: Record<string, number> = {};
  for (const e of d.entries) {
    if (!c.scope.has(e.placeId) || e.date < from || e.date >= to) continue;
    if (e.direction === "in") {
      income += e.amount;
      if (e.source === "stay") {
        stayIncome += e.amount;
        if (e.platform) (channels[e.platform] ??= { nights: 0, income: 0 }).income += e.amount;
      }
    } else {
      expenses += e.amount;
      if (e.source === "stay") platformFees += e.amount;
      const cat = e.category ?? "Uncategorized";
      byCategory[cat] = (byCategory[cat] ?? 0) + e.amount;
      if (e.source !== "stay" && c.prepaid.has(cat)) prepaid += e.amount;
    }
  }

  const arriving = d.stays.filter((s) => c.scope.has(s.placeId) && !s.refunded && s.checkIn >= from && s.checkIn < to);
  const lengths = arriving.map((s) => (ms(s.checkOut) - ms(s.checkIn)) / DAY);
  const leads = arriving.filter((s) => s.bookedOn && s.bookedOn <= s.checkIn).map((s) => (ms(s.checkIn) - ms(s.bookedOn!)) / DAY);
  const result = income - expenses;
  return {
    month, available, blocked, sold,
    occupancy: available ? Math.min(1, sold / available) : null,
    adr: sold ? stayIncome / sold : null,
    revpar: available ? stayIncome / available : null,
    stayIncome, income, platformFees, expenses, result, operating: result + prepaid,
    byCategory, stays: arriving.length, avgLength: mean(lengths), leadDays: mean(leads), channels,
  };
}

/** The first night each villa was booked: before it, it was not on the market. */
export function openingDays(stays: StayRow[]): Map<string, string> {
  const first = new Map<string, string>();
  for (const s of stays) if (!s.refunded && (!first.has(s.placeId) || s.checkIn < first.get(s.placeId)!)) first.set(s.placeId, s.checkIn);
  return first;
}

/**
 * Costs paid ahead: categories with entries (not a stay's) dated after `after`. A lease paid for the year and booked
 * month by month is one. Their monthly share is left out of the "operating" result, since it is already counted
 * in what is committed.
 */
export function prepaidCategories(entries: Entry[], scope: Set<string>, after: string): Set<string> {
  return new Set(entries.filter((e) => scope.has(e.placeId) && e.direction === "out" && e.source !== "stay" && e.date > after)
    .map((e) => e.category ?? "Uncategorized"));
}

// ---------------------------------------------------------------------------
// Goals: where the cumulative result will be on the goal's date, and what it takes to get there.
// ---------------------------------------------------------------------------

export interface GoalStatus {
  goal: Goal;
  /** Income − expenses from `since` to the end of the report's month. */
  cumulative: number;
  /** After the report's month and until the goal's date, already in the books: stays booked (net of fees)… */
  bookedNet: number;
  /** …and costs paid ahead (e.g. the lease's months to come). */
  committed: number;
  monthsLeft: number;
  /** Operating result needed each month left, on top of the stays already booked. */
  requiredPerMonth: number | null;
  /** Operating result per month, last 3 months. */
  pace3: number | null;
  /** Operating result of the same months in the latest year closed (null when some are missing). */
  lastYearSame: number | null;
  /** Cumulative result on the goal's date if the months left do as the same months of the latest year. */
  projected: number | null;
  /** …or as the last 3 months. */
  projectedAtPace: number | null;
  reached: boolean;
  /** The goal's date is past: cumulative is the final figure. */
  over: boolean;
  roi: number | null;
}

/** The same calendar month in the latest year already closed (one, two or three years before `m`). */
function latestSame(m: string, upTo: string, series: Map<string, MonthFigures>): MonthFigures | undefined {
  for (let k = 1; k <= 3; k++) {
    const x = addMonths(m, -12 * k);
    if (x <= upTo && series.has(x)) return series.get(x);
  }
  return undefined;
}

/** Month figures of one scope (a goal's villa, or everything), from its first entry to `month`. */
export function scopedSeries(d: Data, scope: Set<string>, month: string): Map<string, MonthFigures> {
  const ctx: Ctx = {
    scope, villas: d.places.filter((p) => p.kind === "villa" && scope.has(p.id)), opened: openingDays(d.stays),
    prepaid: prepaidCategories(d.entries, scope, monthEnd(month)),
  };
  const firstEntry = d.entries.filter((e) => scope.has(e.placeId)).reduce<string | null>((a, e) => (!a || e.date < a ? e.date : a), null);
  const series = new Map<string, MonthFigures>();
  if (!firstEntry) return series;
  for (let m = monthOf(firstEntry); m <= month; m = addMonths(m, 1)) series.set(m, monthFigures(m, d, ctx));
  return series;
}

/** Where a goal stands; its pace and projection count only its own scope (one villa, or the whole business). */
export function goalStatus(goal: Goal, d: Data, month: string): GoalStatus {
  const end = monthEnd(month);
  const scope = new Set(goal.placeId ? [goal.placeId] : d.places.map((p) => p.id));
  const series = scopedSeries(d, scope, month);
  const until = goal.byDate < end ? goal.byDate : end;
  let cumulative = 0, bookedNet = 0, committed = 0;
  for (const e of d.entries) {
    if (!scope.has(e.placeId) || e.date < goal.since) continue;
    const v = e.direction === "in" ? e.amount : -e.amount;
    if (e.date <= until) cumulative += v;
    else if (e.date <= goal.byDate) {
      if (e.source === "stay") bookedNet += v;
      else if (e.direction === "out") committed += e.amount;
      else bookedNet += v;
    }
  }
  const over = goal.byDate <= end;
  const monthsLeft = over ? 0 : monthsBetween(month, goal.byDate);
  const planned = over ? 0 : goal.planned;
  const need = goal.target - cumulative - bookedNet + committed + planned;
  const recent = [0, 1, 2].map((i) => series.get(addMonths(month, -i))).filter((m): m is MonthFigures => !!m);
  const pace3 = recent.length === 3 ? mean(recent.map((m) => m.operating)) : null;
  const same = Array.from({ length: monthsLeft }, (_, i) => latestSame(addMonths(month, i + 1), month, series));
  const lastYearSame = monthsLeft && same.every(Boolean) ? sum(same.map((m) => m!.operating)) : null;
  return {
    goal, cumulative, bookedNet, committed, monthsLeft,
    requiredPerMonth: monthsLeft ? need / monthsLeft : null,
    pace3, lastYearSame,
    projected: lastYearSame === null ? null : cumulative + lastYearSame - committed - planned,
    projectedAtPace: pace3 === null || !monthsLeft ? null : cumulative + pace3 * monthsLeft - committed - planned,
    reached: cumulative >= goal.target, over,
    roi: goal.invested ? cumulative / goal.invested : null,
  };
}

// ---------------------------------------------------------------------------
// Detections
// ---------------------------------------------------------------------------

export interface Anomaly { category: string; amount: number; average: number; ratio: number | null }

/**
 * Expense categories well above their 6-month average (+30%), or new, and large enough to matter (1% of the
 * average monthly income at least). A stay's platform fee follows the income: not an anomaly.
 */
export function anomalies(month: string, series: Map<string, MonthFigures>, d: Data, scope: Set<string>): Anomaly[] {
  const cur = series.get(month);
  const before = [1, 2, 3, 4, 5, 6].map((i) => series.get(addMonths(month, -i))).filter((m): m is MonthFigures => !!m);
  if (!cur || before.length < 3) return [];
  const feeCats = new Set(d.entries.filter((e) => e.source === "stay" && e.direction === "out" && scope.has(e.placeId)).map((e) => e.category ?? "Uncategorized"));
  const floor = 0.01 * (mean(before.map((m) => m.income)) ?? 0);
  const out: Anomaly[] = [];
  for (const [category, amount] of Object.entries(cur.byCategory)) {
    if (feeCats.has(category)) continue;
    const average = mean(before.map((m) => m.byCategory[category] ?? 0))!;
    if (amount - average < Math.max(floor, 1)) continue;
    if (average > 0 && amount < 1.3 * average) continue;
    out.push({ category, amount, average, ratio: average > 0 ? amount / average : null });
  }
  return out.sort((a, b) => (b.amount - b.average) - (a.amount - a.average)).slice(0, 5);
}

export interface Gap { villa: string; start: string; end: string; nights: number; orphan: boolean }
export interface Calendar {
  from: string; days: number;
  available: number; booked: number; blocked: number; free: number;
  /** Free runs of 1–2 nights between two stays (or blocks): hard to sell. */
  orphanNights: number;
  gaps: Gap[];
  /** Occupancy of the same days one year earlier, as it ended. */
  lastYearOccupancy: number | null;
  /** Each day: per villa, b(ooked), x (blocked) or . (free). For the app. */
  strip: { villa: string; days: string }[];
}

/** The nights ahead: what is booked, blocked and free, and the gaps. */
export function calendar(d: Data, from: string, days = 60): Calendar {
  const villas = d.places.filter((p) => p.kind === "villa");
  const opened = openingDays(d.stays);
  const to = addDays(from, days);
  let booked = 0, blocked = 0, free = 0, orphanNights = 0;
  const gaps: Gap[] = [];
  const strip: Calendar["strip"] = [];
  for (const v of villas) {
    if (!opened.has(v.id)) continue;
    const marks = Array.from({ length: days }, (_, i) => {
      const day = addDays(from, i);
      if (d.stays.some((s) => s.placeId === v.id && !s.refunded && s.checkIn <= day && day < s.checkOut)) return "b";
      if (d.blocks.some((b) => b.placeId === v.id && b.start <= day && day < b.end)) return "x";
      return ".";
    });
    strip.push({ villa: v.name, days: marks.join("") });
    for (const m of marks) {
      if (m === "b") booked++;
      else if (m === "x") blocked++;
      else free++;
    }
    for (let i = 0; i < days;) {
      if (marks[i] !== ".") { i++; continue; }
      let j = i;
      while (j < days && marks[j] === ".") j++;
      const nights = j - i;
      const orphan = nights <= 2 && i > 0 && j < days;
      if (orphan) orphanNights += nights;
      gaps.push({ villa: v.name, start: addDays(from, i), end: addDays(from, j), nights, orphan });
      i = j;
    }
  }
  // Last year, same days: how full the villas ended up.
  const lyFrom = addDays(from, -364), lyTo = addDays(to, -364); // 52 weeks: same weekdays
  let lyAvail = 0, lySold = 0;
  for (const v of villas) {
    const op = opened.get(v.id);
    if (!op || op > lyFrom) continue;
    const sold = new Set<string>();
    for (const s of d.stays) if (s.placeId === v.id && !s.refunded) for (const n of nightsIn(s.checkIn, s.checkOut, lyFrom, lyTo)) sold.add(n);
    const blockedLy = new Set<string>();
    for (const b of d.blocks) if (b.placeId === v.id) for (const n of nightsIn(b.start, b.end, lyFrom, lyTo)) if (!sold.has(n)) blockedLy.add(n);
    lyAvail += days - blockedLy.size;
    lySold += sold.size;
  }
  return {
    from, days, available: booked + free, booked, blocked, free, orphanNights,
    gaps: gaps.sort((a, b) => b.nights - a.nights).slice(0, 8),
    lastYearOccupancy: lyAvail ? lySold / lyAvail : null,
    strip,
  };
}

// ---------------------------------------------------------------------------
// The facts of a report: the figures, flat and named, that Claude may cite.
// ---------------------------------------------------------------------------

export interface Facts {
  engine: number;
  month: string;
  currency: string;
  generatedOn: string;
  metrics: Record<string, Metric>;
  /** The last 13 months, oldest first (charts, and the trend Claude reads). */
  months: MonthFigures[];
  goals: (Omit<GoalStatus, "goal"> & { key: string; id: string; label: string; placeId: string | null; since: string; byDate: string; target: number; invested: number | null; planned: number; plannedNote: string | null })[];
  anomalies: Anomaly[];
  calendar: Calendar;
  prepaid: string[];
  /** What is missing for the figures to be complete: said, never guessed. */
  missing: string[];
}

const MONTHS_KEPT = 13;

/**
 * Everything a report says, for the organization as a whole, for `month` (closed), looking ahead from `today`.
 * Occupancy counts the villas; money counts every place (the company's costs are the business's too).
 */
export function facts(d: Data, month: string, today: string, currency: string): Facts {
  const scope = new Set(d.places.map((p) => p.id));
  const villas = d.places.filter((p) => p.kind === "villa");
  const opened = openingDays(d.stays);
  const end = monthEnd(month);
  const prepaid = prepaidCategories(d.entries, scope, end);
  const ctx: Ctx = { scope, villas, opened, prepaid };

  const firstEntry = d.entries.filter((e) => scope.has(e.placeId)).reduce<string | null>((a, e) => (!a || e.date < a ? e.date : a), null);
  const first = firstEntry && monthOf(firstEntry) < month ? monthOf(firstEntry) : month;
  const series = new Map<string, MonthFigures>();
  for (let m = first; m <= month; m = addMonths(m, 1)) series.set(m, monthFigures(m, d, ctx));
  const cur = series.get(month)!;
  const ly = series.get(addMonths(month, -12)) ?? null;
  const prev3 = [1, 2, 3].map((i) => series.get(addMonths(month, -i))).filter((m): m is MonthFigures => !!m);
  const ttm = (k: number) => {
    const ms12 = Array.from({ length: 12 }, (_, i) => series.get(addMonths(month, -i - k)));
    return ms12.every(Boolean) ? ms12 as MonthFigures[] : null;
  };
  const t0 = ttm(0), t1 = ttm(12);

  const metrics: Record<string, Metric> = {};
  const put = (key: string, label: string, value: number | null | undefined, unit: Unit) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    metrics[key] = { label, value: unit === "percent" ? round(value, 4) : unit === "money" ? round(value) : unit === "ratio" ? round(value, 2) : round(value, 1), unit };
  };
  const prepaidLabel = prepaid.size ? ` (before ${[...prepaid].join(", ")}, paid ahead)` : "";
  const fields: [keyof MonthFigures, string, Unit][] = [
    ["occupancy", "Occupancy", "percent"], ["adr", "Average rate per night sold (ADR)", "money"],
    ["revpar", "Revenue per night available (RevPAR)", "money"], ["sold", "Nights sold", "nights"],
    ["available", "Nights available", "nights"], ["blocked", "Nights blocked (owner, works)", "nights"],
    ["income", "Income", "money"], ["stayIncome", "Stay income", "money"], ["platformFees", "Platform fees", "money"],
    ["expenses", "Expenses", "money"], ["result", "Result (income − expenses)", "money"],
    ["operating", `Operating result${prepaidLabel}`, "money"],
    ["stays", "Stays arriving", "count"], ["avgLength", "Average stay length", "nights"], ["leadDays", "Days booked ahead, on average", "days"],
  ];
  const keyOf = (f: string) => f.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  for (const [f, label, unit] of fields) {
    put(`month.${keyOf(f)}`, label, cur[f] as number | null, unit);
    if (ly) put(`last_year.${keyOf(f)}`, `${label}, same month last year`, ly[f] as number | null, unit);
    if (prev3.length === 3 && !["stays", "avgLength", "leadDays"].includes(f)) {
      const v = f === "occupancy" ? (sum(prev3.map((m) => m.available)) ? sum(prev3.map((m) => m.sold)) / sum(prev3.map((m) => m.available)) : null)
        : f === "adr" ? (sum(prev3.map((m) => m.sold)) ? sum(prev3.map((m) => m.stayIncome)) / sum(prev3.map((m) => m.sold)) : null)
        : f === "revpar" ? (sum(prev3.map((m) => m.available)) ? sum(prev3.map((m) => m.stayIncome)) / sum(prev3.map((m) => m.available)) : null)
        : mean(prev3.map((m) => m[f] as number));
      put(`prev3.${keyOf(f)}`, `${label}, average of the 3 months before`, v, unit);
    }
  }
  if (t0) {
    put("ttm.income", "Income, last 12 months", sum(t0.map((m) => m.income)), "money");
    put("ttm.result", "Result, last 12 months", sum(t0.map((m) => m.result)), "money");
    put("ttm.operating", `Operating result, last 12 months${prepaidLabel}`, sum(t0.map((m) => m.operating)), "money");
    const a = sum(t0.map((m) => m.available));
    put("ttm.occupancy", "Occupancy, last 12 months", a ? sum(t0.map((m) => m.sold)) / a : null, "percent");
  }
  if (t1) {
    put("prev_ttm.income", "Income, the 12 months before", sum(t1.map((m) => m.income)), "money");
    put("prev_ttm.result", "Result, the 12 months before", sum(t1.map((m) => m.result)), "money");
  }
  for (const [cat, amount] of Object.entries(cur.byCategory)) {
    put(`cost.${slug(cat)}`, `${cat}, this month`, amount, "money");
    const six = [1, 2, 3, 4, 5, 6].map((i) => series.get(addMonths(month, -i))).filter((m): m is MonthFigures => !!m);
    if (six.length >= 3) put(`cost.${slug(cat)}.avg6`, `${cat}, monthly average of the 6 months before`, mean(six.map((m) => m.byCategory[cat] ?? 0)), "money");
  }
  const nightsAll = sum(Object.values(cur.channels).map((c) => c.nights));
  for (const [p, c] of Object.entries(cur.channels)) {
    put(`channel.${slug(p)}.nights_share`, `Share of nights sold through ${p}`, nightsAll ? c.nights / nightsAll : null, "percent");
    put(`channel.${slug(p)}.income`, `Stay income through ${p}`, c.income, "money");
  }

  const goals = d.goals.map((g, i) => {
    const s = goalStatus(g, d, month);
    const k = `goal.${i + 1}`;
    put(`${k}.cumulative`, `${g.label}: cumulative result since ${g.since}`, s.cumulative, "money");
    put(`${k}.target`, `${g.label}: target by ${g.byDate}`, g.target, "money");
    put(`${k}.months_left`, `${g.label}: months left`, s.monthsLeft, "months");
    put(`${k}.booked_net`, `${g.label}: stays already booked before ${g.byDate}, net`, s.bookedNet, "money");
    put(`${k}.committed`, `${g.label}: costs paid ahead still to come before ${g.byDate}`, s.committed, "money");
    if (!s.over && g.planned) put(`${k}.planned`, `${g.label}: investment planned, not in the books yet${g.plannedNote ? ` (${g.plannedNote})` : ""}`, g.planned, "money");
    put(`${k}.required_per_month`, `${g.label}: operating result needed per month left`, s.requiredPerMonth, "money");
    put(`${k}.pace3`, "Operating result per month, last 3 months", s.pace3, "money");
    put(`${k}.last_year_same`, `${g.label}: operating result of the same months, latest year`, s.lastYearSame, "money");
    put(`${k}.projected`, `${g.label}: cumulative on ${g.byDate} if the months left do as the same months of the latest year`, s.projected, "money");
    put(`${k}.projected_at_pace`, `${g.label}: cumulative on ${g.byDate} at the last 3 months' pace`, s.projectedAtPace, "money");
    put(`${k}.roi`, `${g.label}: return on the capital invested so far`, s.roi, "percent");
    return { key: k, id: g.id, label: g.label, placeId: g.placeId, since: g.since, byDate: g.byDate, target: g.target, invested: g.invested, planned: g.planned, plannedNote: g.plannedNote, ...omitGoal(s) };
  });

  const anomalyList = anomalies(month, series, d, scope);
  for (const a of anomalyList) put(`anomaly.${slug(a.category)}`, `${a.category}: this month against its 6-month average`, a.ratio ?? null, "ratio");

  const cal = calendar(d, today, 60);
  put("calendar.booked_nights", `Nights booked, next ${cal.days} days`, cal.booked, "nights");
  put("calendar.free_nights", `Nights free, next ${cal.days} days`, cal.free, "nights");
  put("calendar.orphan_nights", `Free nights in gaps of 1–2 nights, next ${cal.days} days`, cal.orphanNights, "nights");
  put("calendar.occupancy", `Occupancy booked so far, next ${cal.days} days`, cal.available ? cal.booked / cal.available : null, "percent");
  put("calendar.last_year_occupancy", `Occupancy of the same days last year, as it ended`, cal.lastYearOccupancy, "percent");

  const missing: string[] = [];
  if (!d.blocks.length) missing.push("No blocked nights recorded (owner stays, works): occupancy counts every night as for sale.");
  if (!d.goals.length) missing.push("No goal set: Sply cannot say whether the business is on track.");
  for (const g of d.goals) if (!g.invested) missing.push(`Goal "${g.label}": capital invested not set, so no return on it.`);
  const known = d.stays.filter((s) => !s.refunded && s.checkIn >= addMonths(month, -11) && s.checkIn <= end);
  if (known.length && known.filter((s) => s.bookedOn).length < known.length / 2) missing.push("Booking dates are known for few stays (only those read from the platform's e-mails): lead time is partial.");
  if (!ly) missing.push("No same month last year to compare with.");

  return {
    engine: ENGINE, month, currency, generatedOn: today, metrics,
    months: [...series.values()].slice(-MONTHS_KEPT),
    goals, anomalies: anomalyList, calendar: cal, prepaid: [...prepaid], missing,
  };
}

function omitGoal(s: GoalStatus): Omit<GoalStatus, "goal"> {
  const rest: Partial<GoalStatus> = { ...s };
  delete rest.goal;
  return rest as Omit<GoalStatus, "goal">;
}

// ---------------------------------------------------------------------------
// A goal's path, for its chart: the cumulative result month by month, then where it heads.
// ---------------------------------------------------------------------------

export interface GoalPath {
  actual: { month: string; value: number }[];
  /** The months left, each as the same month last year (or at the last 3 months' pace when missing), less what is committed. */
  projection: { month: string; value: number }[];
  target: number;
}

export function goalPath(goal: Goal, d: Data, month: string): GoalPath {
  const scope = new Set(goal.placeId ? [goal.placeId] : d.places.map((p) => p.id));
  const end = monthEnd(month);
  const ctx: Ctx = {
    scope, villas: d.places.filter((p) => p.kind === "villa" && scope.has(p.id)), opened: openingDays(d.stays),
    prepaid: prepaidCategories(d.entries, scope, end),
  };
  const lastMonth = monthOf(goal.byDate) < month ? monthOf(goal.byDate) : month;
  const byMonth = new Map<string, number>();
  for (const e of d.entries) {
    if (!scope.has(e.placeId) || e.date < goal.since) continue;
    const k = monthOf(e.date);
    byMonth.set(k, (byMonth.get(k) ?? 0) + (e.direction === "in" ? e.amount : -e.amount));
  }
  const actual: GoalPath["actual"] = [];
  let run = 0;
  for (let m = monthOf(goal.since); m <= lastMonth; m = addMonths(m, 1)) {
    run += byMonth.get(m) ?? 0;
    actual.push({ month: m, value: run });
  }
  const projection: GoalPath["projection"] = [];
  if (goal.byDate > end) {
    const series = new Map<string, MonthFigures>();
    const fig = (m: string) => {
      if (!series.has(m)) series.set(m, monthFigures(m, d, ctx));
      return series.get(m)!;
    };
    const first = d.entries.reduce<string | null>((a, e) => (scope.has(e.placeId) && (!a || e.date < a) ? e.date : a), null);
    const has = (m: string) => !!first && m >= monthOf(first) && m <= month;
    const pace = [0, 1, 2].every((i) => has(addMonths(month, -i))) ? sum([0, 1, 2].map((i) => fig(addMonths(month, -i)).operating)) / 3 : null;
    let value = run;
    projection.push({ month, value });
    for (let m = addMonths(month, 1); m <= monthOf(goal.byDate); m = addMonths(m, 1)) {
      const ly = [1, 2, 3].map((k) => addMonths(m, -12 * k)).find(has);
      const made = ly ? fig(ly).operating : pace;
      if (made === null) break;
      const committed = sum(d.entries.filter((e) => scope.has(e.placeId) && e.direction === "out" && e.source !== "stay" && monthOf(e.date) === m && e.date <= goal.byDate).map((e) => e.amount));
      // What is planned but not booked yet is spread over the months left (a lease is paid for its months).
      value += made - committed - goal.planned / monthsBetween(month, goal.byDate);
      projection.push({ month: m, value });
    }
  }
  return { actual, projection, target: goal.target };
}
