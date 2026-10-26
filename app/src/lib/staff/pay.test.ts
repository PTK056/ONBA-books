import { test } from "node:test";
import assert from "node:assert/strict";
import { computePay, payPeriod, type StaffPay, type WorkLog } from "./pay.ts";

const base: StaffPay = { pay_mode: "monthly", payday: 25, currency: "IDR", monthly_amount: null, hourly_rate: null, job_rate: null, base_unit: null, base_per_week: null, extra_rate: null };
const day = (date: string, x: Partial<WorkLog> = {}): WorkLog => ({ date, hours: null, jobs: 1, extra_amount: null, ...x });
const run = (from: string, n: number, x: Partial<WorkLog> = {}) =>
  Array.from({ length: n }, (_, i) => day(new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10), x));

test("pay period: from the day after the previous payday to this payday", () => {
  assert.deepEqual(payPeriod("2026-11", 25), { from: "2026-10-26", to: "2026-11-25", days: 31 });
  assert.deepEqual(payPeriod("2026-03", 25), { from: "2026-02-26", to: "2026-03-25", days: 28 });
  assert.deepEqual(payPeriod("2027-01", 25), { from: "2026-12-26", to: "2027-01-25", days: 31 });
});

test("a visit after October's payday counts for November", () => {
  const p = { ...base, pay_mode: "per_job" as const, job_rate: 150_000 };
  const logs = [day("2026-10-25"), day("2026-10-28")];
  assert.equal(computePay(p, logs, "2026-10").jobs, 1); // the 25th: last day of October's period
  assert.equal(computePay(p, logs, "2026-11").jobs, 1); // the 28th: first visit of November's period
});

test("monthly without a base: the fixed amount plus one-off extras", () => {
  const p = computePay({ ...base, monthly_amount: 2_000_000 }, [day("2026-10-01"), day("2026-10-12", { jobs: null, extra_amount: 150_000 })], "2026-10");
  assert.equal(p.total, 2_150_000);
  assert.equal(p.days_worked, 1);
});

test("monthly with a weekly base of visits: extras beyond the period's base", () => {
  // 3 visits/week over 26 Oct → 25 Nov (31 days) = 13; 15 visits → 2 extras.
  const p = computePay({ ...base, monthly_amount: 2_000_000, base_unit: "visits", base_per_week: 3, extra_rate: 150_000 }, run("2026-10-28", 15), "2026-11");
  assert.equal(p.base?.this_month, 13);
  assert.equal(p.base?.extra_units, 2);
  assert.equal(p.total, 2_300_000);
});

test("monthly base: no deduction when fewer visits than the base", () => {
  assert.equal(computePay({ ...base, monthly_amount: 2_000_000, base_unit: "visits", base_per_week: 3 }, [day("2026-11-02")], "2026-11").total, 2_000_000);
});

test("monthly base without an extra rate: fixed ÷ base of the period", () => {
  const p = computePay({ ...base, monthly_amount: 1_300_000, base_unit: "visits", base_per_week: 3 }, run("2026-10-26", 14), "2026-11");
  assert.equal(p.base?.extra_rate, 100_000);
  assert.equal(p.total, 1_400_000);
});

test("monthly with a base in hours", () => {
  // 10 h/week over 26 Jan → 25 Feb (31 days) = 44 h; 49 h done → 5 extra hours.
  const logs = [day("2026-01-30", { jobs: null, hours: 30 }), day("2026-02-16", { jobs: null, hours: 19 })];
  const p = computePay({ ...base, monthly_amount: 2_000_000, base_unit: "hours", base_per_week: 10, extra_rate: 60_000 }, logs, "2026-02");
  assert.equal(p.base?.this_month, 44);
  assert.equal(p.total, 2_300_000);
});

test("hourly: hours × rate", () => {
  const p = computePay({ ...base, pay_mode: "hourly", hourly_rate: 25_000 }, [day("2026-10-01", { jobs: null, hours: 3 }), day("2026-10-02", { jobs: null, hours: 2.5 })], "2026-10");
  assert.equal(p.hours, 5.5);
  assert.equal(p.total, 137_500);
});

test("per job: jobs × rate, a day counts as one job unless a number is given", () => {
  const p = computePay({ ...base, pay_mode: "per_job", job_rate: 150_000 }, [day("2026-10-03"), day("2026-10-10", { jobs: 2 }), day("2026-10-11", { jobs: null, hours: 4 })], "2026-10");
  assert.equal(p.jobs, 4);
  assert.equal(p.total, 600_000);
});

test("no work logged: monthly still paid, per job is zero", () => {
  assert.equal(computePay({ ...base, monthly_amount: 2_000_000 }, [], "2026-10").total, 2_000_000);
  assert.equal(computePay({ ...base, pay_mode: "per_job", job_rate: 150_000 }, [], "2026-10").total, 0);
});
