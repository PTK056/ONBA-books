// node --test src/lib/bank/recurring.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { monthlyTemplate, retitle, type PastEntry } from "./recurring.ts";

const e = (id: string, date: string, amount: number, description: string): PastEntry =>
  ({ id, date, direction: "out", amount, amountReporting: amount, villaId: "V", categoryId: "C", category: "Pool", description });

// Real case (August 2026): pool service paid on the 26th, July and September booked, August missing.
test("a missing month is offered like the month before", () => {
  const t = monthlyTemplate({ date: "2026-08-26", direction: "out", amount: 600000 },
    [e("JUL", "2026-07-26", 600000, "Pool maintenance (Monthly service)"), e("SEP", "2026-09-26", 600000, "Pool service fee — September 2026 (Monthly service)")]);
  assert.equal(t?.fromId, "JUL");
  assert.equal(t?.description, "Pool maintenance (Monthly service)");
});

test("with only the month after, its title is moved to this month", () => {
  const t = monthlyTemplate({ date: "2026-08-26", direction: "out", amount: 600000 },
    [e("SEP", "2026-09-26", 600000, "Pool service fee — September 2026 (Monthly service)")]);
  assert.equal(t?.description, "Pool service fee — August 2026 (Monthly service)");
});

test("nothing when this month's entry is already there, or nothing a month apart", () => {
  assert.equal(monthlyTemplate({ date: "2026-08-26", direction: "out", amount: 600000 },
    [e("JUL", "2026-07-26", 600000, "x"), e("AUG", "2026-08-25", 600000, "x")]), null);
  assert.equal(monthlyTemplate({ date: "2026-08-26", direction: "out", amount: 600000 }, [e("MAY", "2026-05-26", 600000, "x")]), null);
});

test("month names and numbers are moved", () => {
  assert.equal(retitle("Laundry 2026-07 (Kamalis)", "2026-07-31", "2026-08-31"), "Laundry 2026-08 (Kamalis)");
  assert.equal(retitle("Internet Jul 2026", "2026-07-03", "2026-08-03"), "Internet Aug 2026");
  assert.equal(retitle("Salary 07/2026", "2026-07-25", "2026-08-25"), "Salary 08/2026");
  assert.equal(retitle("Gardener", "2026-07-25", "2026-08-25"), "Gardener");
});
