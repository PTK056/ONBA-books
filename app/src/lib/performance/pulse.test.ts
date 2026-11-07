import assert from "node:assert/strict";
import { test } from "node:test";
import { addMonths, facts, type Data, type Entry } from "./metrics.ts";
import { pulse } from "./pulse.ts";

const V = "villa";
const places = [{ id: V, name: "Casa", kind: "villa" as const }];
const out = (date: string, amount: number, category: string): Entry => ({ date, placeId: V, direction: "out", amount, source: "manual", category, platform: null });
const night = (date: string, amount: number): Entry => ({ date, placeId: V, direction: "in", amount, source: "stay", category: "Accommodation", platform: "airbnb" });
const fee = (date: string, amount: number): Entry => ({ date, placeId: V, direction: "out", amount, source: "stay", category: "Platform fees", platform: "airbnb" });
const stay = (checkIn: string, checkOut: string) => ({ placeId: V, checkIn, checkOut, platform: "airbnb", refunded: false, bookedOn: null });
// A lease booked month by month, a year ahead: a cost paid ahead.
const lease = Array.from({ length: 24 }, (_, i) => out(addMonths("2025-10-01", i), 20_000_000, "Lease"));

function data(): Data {
  return {
    places, goals: [], blocks: [],
    stays: [stay("2025-11-10", "2025-11-20"), stay("2026-10-05", "2026-10-15"), stay("2026-11-05", "2026-11-09"), stay("2026-11-20", "2026-11-25")],
    entries: [
      ...lease,
      night("2025-11-10", 30_000_000), out("2025-11-15", 2_000_000, "Electricity"),
      night("2026-10-05", 25_000_000), fee("2026-10-05", 4_000_000), out("2026-10-12", 2_000_000, "Electricity"),
      night("2026-11-05", 12_000_000), fee("2026-11-05", 2_000_000), night("2026-11-20", 15_000_000), fee("2026-11-20", 2_500_000),
      out("2026-11-03", 1_000_000, "Electricity"),
    ],
  };
}

test("the live month: a profit or a loss, its income against its expenses, the lease inside them", () => {
  const p = pulse(facts(data(), "2026-11-01", "2026-11-07", "IDR"), "2026-11-07");
  assert.equal(p.live, true);
  assert.deepEqual([p.income, p.expenses, p.result], [27_000_000, 25_500_000, 1_500_000]);
  assert.deepEqual(p.prepaid, { names: ["Lease"], amount: 20_000_000 });
  assert.equal(p.vsLastMonth?.result, -1_000_000);
  assert.equal(p.vsLastYear?.result, 8_000_000);
});

test("what is left to sell: free nights this month, the next 30 days, the first gap", () => {
  const p = pulse(facts(data(), "2026-11-01", "2026-11-07", "IDR"), "2026-11-07");
  // From Nov 7 to Nov 30: 24 nights, 2 booked (7, 8) and 5 booked (20–24): 17 free.
  assert.equal(p.nightsLeft, 17);
  assert.deepEqual(p.nextGap, { villa: "Casa", start: "2026-11-09", end: "2026-11-20", nights: 11 });
  assert.equal(p.next30.booked, 7);
  assert.equal(p.next30.available, 30);
});

test("a closed month is not live: nothing left to sell is said", () => {
  const p = pulse(facts(data(), "2026-10-01", "2026-11-07", "IDR"), "2026-11-07");
  assert.equal(p.live, false);
  assert.equal(p.nightsLeft, null);
  assert.equal(p.result, 25_000_000 - 4_000_000 - 2_000_000 - 20_000_000);
});

test("a goal in one line: how far along, and whether it is on its way", () => {
  const d = data();
  d.goals = [{ id: "g", label: "Pay back the works", placeId: null, since: "2025-10-01", byDate: "2027-12-31", target: 100_000_000, invested: null, planned: 0, plannedNote: null }];
  const p = pulse(facts(d, "2026-11-01", "2026-11-07", "IDR"), "2026-11-07");
  assert.equal(p.goal?.label, "Pay back the works");
  assert.equal(p.goal?.progress, 0, "a loss so far is no progress, never below zero");
});
