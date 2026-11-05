import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonths, anomalies, calendar, facts, goalStatus, monthFigures, monthsBetween, openingDays, prepaidCategories,
  type Data, type Entry, type Goal, type MonthFigures,
} from "./metrics.ts";

const V = "villa", C = "company";
const places = [{ id: V, name: "Casa", kind: "villa" as const }, { id: C, name: "PT Co", kind: "company" as const }];
const out = (date: string, amount: number, category: string, placeId = V): Entry => ({ date, placeId, direction: "out", amount, source: "manual", category, platform: null });
const stayIn = (date: string, amount: number, platform = "airbnb"): Entry => ({ date, placeId: V, direction: "in", amount, source: "stay", category: "Accommodation", platform });
const fee = (date: string, amount: number): Entry => ({ date, placeId: V, direction: "out", amount, source: "stay", category: "Platform fees", platform: "airbnb" });
const stay = (checkIn: string, checkOut: string, over: Partial<Data["stays"][0]> = {}) => ({ placeId: V, checkIn, checkOut, platform: "airbnb", refunded: false, bookedOn: null, ...over });

// A lease paid for two years, booked month by month from April 2025 to March 2027 (into the future).
const lease: Entry[] = Array.from({ length: 24 }, (_, i) => out(addMonths("2025-04-01", i), 20_000_000, "Lease"));

function base(over: Partial<Data> = {}): Data {
  return {
    places, goals: [],
    entries: [
      ...lease,
      out("2025-05-01", 100_000_000, "Equipment"),
      out("2025-11-01", 1_000_000, "Bank fees", C),
      stayIn("2025-11-05", 30_000_000), fee("2025-11-05", 4_000_000), out("2025-11-10", 2_000_000, "Electricity"),
      stayIn("2025-12-01", 40_000_000), out("2025-12-10", 2_000_000, "Electricity"),
      stayIn("2026-08-01", 30_000_000), out("2026-08-10", 2_000_000, "Electricity"),
      stayIn("2026-09-01", 30_000_000), out("2026-09-10", 2_000_000, "Electricity"),
      stayIn("2026-10-01", 20_000_000), fee("2026-10-01", 3_000_000), out("2026-10-10", 2_000_000, "Electricity"),
      out("2026-10-12", 3_000_000, "Pool"),
    ],
    stays: [
      stay("2025-06-07", "2025-06-10"),
      stay("2025-11-05", "2025-11-15"),
      stay("2025-12-01", "2025-12-21"),
      stay("2026-09-25", "2026-10-05", { bookedOn: "2026-09-05" }), // 6 nights in September, 4 in October
      stay("2026-10-10", "2026-10-15", { platform: "direct", bookedOn: "2026-10-01" }),
      stay("2026-10-15", "2026-10-18", { refunded: true }),
    ],
    blocks: [{ placeId: V, start: "2026-10-20", end: "2026-10-29", reason: "owner" }],
    ...over,
  };
}

const ctx = (d: Data, after = "2026-10-31") => {
  const scope = new Set(d.places.map((p) => p.id));
  return { scope, villas: d.places.filter((p) => p.kind === "villa"), opened: openingDays(d.stays), prepaid: prepaidCategories(d.entries, scope, after) };
};

test("a month's nights: blocked nights are not for sale, a refunded stay sells none, a stay across months counts in each", () => {
  const d = base();
  const m = monthFigures("2026-10-01", d, ctx(d));
  assert.equal(m.blocked, 9, "the owner's 20 → 29 October");
  assert.equal(m.available, 31 - 9);
  assert.equal(m.sold, 4 + 5, "4 nights of the September stay, 5 of the direct one; the refunded one sells none");
  assert.equal(m.occupancy, 9 / 22);
  assert.equal(m.adr, 20_000_000 / 9);
  assert.equal(m.revpar, 20_000_000 / 22);
  assert.equal(m.platformFees, 3_000_000);
  assert.equal(m.expenses, 20_000_000 + 3_000_000 + 2_000_000 + 3_000_000);
  assert.equal(m.result, 20_000_000 - 28_000_000);
  assert.equal(m.operating, m.result + 20_000_000, "the lease, paid ahead, is left out of what the month made");
  assert.deepEqual(m.channels, { airbnb: { nights: 4, income: 20_000_000 }, direct: { nights: 5, income: 0 } });
  assert.equal(m.stays, 1, "stays arriving in the month, refunded ones aside");
  assert.equal(m.leadDays, 9);
});

test("before its first booked night a villa is not on the market", () => {
  const d = base();
  assert.equal(monthFigures("2025-05-01", d, ctx(d)).available, 0);
  assert.equal(monthFigures("2025-05-01", d, ctx(d)).occupancy, null);
  assert.equal(monthFigures("2025-06-01", d, ctx(d)).available, 24, "from 7 June");
});

test("costs booked into months to come are paid ahead; a stay's fees never are", () => {
  const d = base({ entries: [...base().entries, fee("2026-11-09", 2_000_000)] });
  assert.deepEqual([...prepaidCategories(d.entries, new Set([V, C]), "2026-10-31")], ["Lease"]);
});

test("months between", () => {
  assert.equal(monthsBetween("2026-10-01", "2027-04-30"), 6);
  assert.equal(monthsBetween("2026-10-01", "2026-10-31"), 0);
  assert.equal(monthsBetween("2026-10-01", "2028-03-31"), 17);
});

const breakEven: Goal = { id: "g1", label: "Break even", placeId: null, since: "2024-10-01", byDate: "2027-04-30", target: 0, invested: 600_000_000, planned: 20_000_000, plannedNote: "April share of the next lease year" };

function seriesOf(d: Data, upTo = "2026-10-01") {
  const c = ctx(d);
  const s = new Map<string, MonthFigures>();
  for (let m = "2024-10-01"; m <= upTo; m = addMonths(m, 1)) s.set(m, monthFigures(m, d, c));
  return s;
}

test("a goal: where the result stands, what is committed, what each month left must make", () => {
  const d = base({ entries: [...base().entries, stayIn("2026-11-09", 25_000_000), fee("2026-11-09", 4_000_000)] });
  const s = goalStatus(breakEven, d, "2026-10-01");
  const booked = d.entries.filter((e) => e.date <= "2026-10-31");
  const cumulative = booked.reduce((t, e) => t + (e.direction === "in" ? e.amount : -e.amount), 0);
  assert.equal(s.cumulative, cumulative);
  assert.equal(s.bookedNet, 21_000_000, "the November stay, net of its fee");
  assert.equal(s.committed, 5 * 20_000_000, "the lease from November to March");
  assert.equal(s.monthsLeft, 6);
  assert.equal(s.requiredPerMonth, (0 - cumulative - 21_000_000 + 100_000_000 + 20_000_000) / 6);
  assert.equal(s.roi, cumulative / 600_000_000);
  assert.equal(s.reached, false);
  assert.equal(s.over, false);
});

test("a goal's projection: the months left as the same months last year, or at the last 3 months' pace", () => {
  const d = base();
  const series = seriesOf(d);
  const s = goalStatus(breakEven, d, "2026-10-01");
  // Nov 2025 → Apr 2026 operating (lease left out): Nov 30 − 4 − 2 − 1 (company fees count), Dec 40 − 2, then nothing.
  assert.equal(s.lastYearSame, (30_000_000 - 4_000_000 - 2_000_000 - 1_000_000) + (40_000_000 - 2_000_000));
  assert.equal(s.projected, s.cumulative + s.lastYearSame! - s.committed - 20_000_000);
  const pace = [series.get("2026-08-01")!, series.get("2026-09-01")!, series.get("2026-10-01")!].reduce((t, m) => t + m.operating, 0) / 3;
  assert.equal(s.pace3, pace);
  assert.equal(s.projectedAtPace, s.cumulative + pace * 6 - s.committed - 20_000_000);
});

test("a goal whose date is past gives its final figure", () => {
  const d = base();
  const s = goalStatus({ ...breakEven, byDate: "2026-06-30" }, d, "2026-10-01");
  assert.equal(s.over, true);
  assert.equal(s.monthsLeft, 0);
  assert.equal(s.requiredPerMonth, null);
  assert.equal(s.committed, 0);
});

test("an expense well above its 6-month average is flagged; platform fees and small sums are not", () => {
  const d = base({ entries: [...base().entries, out("2026-05-10", 2_000_000, "Electricity"), out("2026-06-10", 2_000_000, "Electricity"), out("2026-07-10", 2_000_000, "Electricity"),
    out("2026-10-20", 3_000_000, "Electricity"), out("2026-10-21", 50_000, "Garden")] });
  const a = anomalies("2026-10-01", seriesOf(d), d, new Set([V, C]));
  assert.deepEqual(a.map((x) => x.category), ["Electricity", "Pool"]);
  assert.equal(a[0].ratio, 5_000_000 / (10_000_000 / 6), "April had none: the average is over 6 months");
  assert.equal(a[1].ratio, null, "a new expense");
});

test("the nights ahead: booked, blocked, free, and gaps too short to sell", () => {
  const d = base({
    stays: [stay("2025-01-01", "2025-01-02"), stay("2026-11-01", "2026-11-05"), stay("2026-11-07", "2026-11-12"), stay("2026-11-28", "2026-12-02")],
    blocks: [{ placeId: V, start: "2026-11-20", end: "2026-11-22", reason: "works" }],
  });
  const c = calendar(d, "2026-11-01", 30);
  assert.equal(c.booked, 4 + 5 + 3);
  assert.equal(c.blocked, 2);
  assert.equal(c.free, 30 - 12 - 2);
  assert.equal(c.orphanNights, 2, "5 → 7 November");
  assert.deepEqual(c.gaps.find((g) => g.orphan), { villa: "Casa", start: "2026-11-05", end: "2026-11-07", nights: 2, orphan: true });
  assert.equal(c.strip[0].days.slice(0, 8), "bbbb..bb");
  assert.equal(c.lastYearOccupancy, 0, "the same days last year were not sold");
});

test("the facts of a report: named figures, goals, what is missing", () => {
  const f = facts(base({ goals: [breakEven] }), "2026-10-01", "2026-11-05", "IDR");
  assert.equal(f.metrics["month.occupancy"].value, Math.round((9 / 22) * 10_000) / 10_000);
  assert.equal(f.metrics["month.occupancy"].unit, "percent");
  assert.match(f.metrics["month.operating"].label, /before Lease, paid ahead/);
  assert.ok(f.metrics["last_year.income"], "October 2025 exists");
  assert.ok(f.metrics["prev3.adr"]);
  assert.ok(f.metrics["goal.1.required_per_month"]);
  assert.ok(f.metrics["cost.electricity"]);
  assert.ok(f.metrics["channel.direct.nights_share"]);
  assert.ok(f.metrics["calendar.free_nights"]);
  assert.equal(f.months.length, 13);
  assert.equal(f.months.at(-1)!.month, "2026-10-01");
  assert.deepEqual(f.prepaid, ["Lease"]);
  assert.equal(f.goals[0].key, "goal.1");
  assert.ok(!f.missing.some((m) => /No goal/.test(m)));
  const bare = facts(base({ blocks: [] }), "2026-10-01", "2026-11-05", "IDR");
  assert.ok(bare.missing.some((m) => /No blocked nights/.test(m)));
  assert.ok(bare.missing.some((m) => /No goal set/.test(m)));
  assert.ok(Object.keys(f.metrics).every((k) => /^[a-z0-9_.]+$/.test(k)), "keys Claude can cite");
});

test("a goal's path: the cumulative result so far, then the months left as last year, less what is committed", async () => {
  const { goalPath } = await import("./metrics.ts");
  const d = base();
  const p = goalPath(breakEven, d, "2026-10-01");
  const s = goalStatus(breakEven, d, "2026-10-01");
  assert.equal(p.actual[0].month, "2024-10-01");
  assert.equal(p.actual.at(-1)!.month, "2026-10-01");
  assert.equal(p.actual.at(-1)!.value, s.cumulative);
  assert.equal(p.projection.at(-1)!.month, "2027-04-01");
  assert.equal(Math.round(p.projection.at(-1)!.value), Math.round(s.projected!), "ends where the goal's projection says");
});

test("a goal further than a year away takes each month from the latest year closed", async () => {
  const d = base();
  const far: Goal = { ...breakEven, byDate: "2028-03-31", planned: 0 };
  const s = goalStatus(far, d, "2026-10-01");
  // Nov 2026 → Mar 2027 from 2025-11 → 2026-03; Apr 2027 → Oct 2027 from 2026-04 → 2026-10; Nov 2027 → Mar 2028 from 2025-11 → 2026-03 again.
  const op = (m: string) => seriesOf(d).get(m)!.operating;
  const months = ["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01"];
  const expected = 2 * months.reduce((t, m) => t + op(m), 0) + ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"].reduce((t, m) => t + op(m), 0);
  assert.equal(s.monthsLeft, 17);
  assert.equal(s.lastYearSame, expected);
  const { goalPath } = await import("./metrics.ts");
  assert.equal(Math.round(goalPath(far, d, "2026-10-01").projection.at(-1)!.value), Math.round(s.projected!));
});

test("a villa's goal counts that villa only: its pace leaves out the company and the other villas", async () => {
  const d = base({ entries: [...base().entries, out("2026-09-15", 9_000_000, "Accountant", C), out("2026-10-15", 9_000_000, "Accountant", C)] });
  const all = goalStatus(breakEven, d, "2026-10-01");
  const villa = goalStatus({ ...breakEven, placeId: V }, d, "2026-10-01");
  assert.equal(Math.round(villa.pace3! - all.pace3!), 18_000_000 / 3, "the company's fees are not the villa's");
  const { goalPath } = await import("./metrics.ts");
  assert.equal(Math.round(goalPath({ ...breakEven, placeId: V }, d, "2026-10-01").projection.at(-1)!.value), Math.round(villa.projected!), "chart and figures agree");
});

test("a month before the first entry still has its figures (a new organization)", () => {
  const d = base({ entries: [stayIn("2026-11-03", 5_000_000)], stays: [stay("2026-11-03", "2026-11-05")] });
  const f = facts(d, "2026-10-01", "2026-11-05", "IDR");
  assert.equal(f.months.length, 1);
  assert.equal(f.metrics["month.income"].value, 0);
});
