// node --test src/lib/bank/match.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { matchLines, type BankLineIn, type BookEntry, type StayNet } from "./match.ts";

const line = (id: string, date: string, amount: number, direction: "in" | "out" = "out", currency = "IDR"): BankLineIn =>
  ({ id, date, amount, direction, currency });
const entry = (id: string, date: string, amount: number, direction: "in" | "out" = "out", currency = "IDR", rate = 1): BookEntry =>
  ({ id, date, amount, direction, currency, amountReporting: amount * rate });

test("same amount a few days after the invoice is matched", () => {
  assert.deepEqual(matchLines([line("L1", "2026-10-05", 350000)], [entry("T1", "2026-10-02", 350000)], [], "IDR"),
    [{ lineId: "L1", kind: "transaction", transactionId: "T1" }]);
});

test("too far apart, other direction or other amount: no match", () => {
  const lines = [line("L1", "2026-10-20", 350000)];
  assert.deepEqual(matchLines(lines, [entry("T1", "2026-10-02", 350000)], [], "IDR"), []);
  assert.deepEqual(matchLines(lines, [entry("T2", "2026-10-19", 350000, "in")], [], "IDR"), []);
  assert.deepEqual(matchLines(lines, [entry("T3", "2026-10-19", 350001)], [], "IDR"), []);
});

test("two equally close candidates: left for a person", () => {
  const out = matchLines([line("L1", "2026-10-05", 100000)],
    [entry("T1", "2026-10-04", 100000), entry("T2", "2026-10-06", 100000)], [], "IDR");
  assert.deepEqual(out, []);
});

test("the closest of several is taken when it is the only closest", () => {
  const out = matchLines([line("L1", "2026-10-05", 100000)],
    [entry("T1", "2026-10-05", 100000), entry("T2", "2026-10-01", 100000)], [], "IDR");
  assert.deepEqual(out, [{ lineId: "L1", kind: "transaction", transactionId: "T1" }]);
});

test("two identical payments pair up one to one by date", () => {
  const out = matchLines(
    [line("L1", "2026-10-01", 500000), line("L2", "2026-10-15", 500000)],
    [entry("T1", "2026-10-01", 500000), entry("T2", "2026-10-14", 500000)], [], "IDR");
  assert.deepEqual(out.map((m) => m.lineId + (m.kind === "transaction" ? m.transactionId : "")).sort(), ["L1T1", "L2T2"]);
});

test("an entry in another currency matches on its converted amount", () => {
  const out = matchLines([line("L1", "2026-10-05", 1_100_000)], [entry("T1", "2026-10-05", 100, "out", "AUD", 11000)], [], "IDR");
  assert.equal(out.length, 1);
});

const stay = (id: string, checkIn: string, checkOut: string, netReporting: number, payoutDate: string | null = null): StayNet =>
  ({ id, checkIn, checkOut, netReporting, payoutDate });

test("one Airbnb payout matches all the stays of its payout date", () => {
  const out = matchLines([line("L1", "2026-10-03", 1_893_667, "in")], [],
    [stay("S1", "2026-09-18", "2026-09-21", 1_000_000, "2026-10-01"), stay("S2", "2026-09-18", "2026-09-20", 893_667, "2026-10-01")], "IDR");
  assert.deepEqual(out, [{ lineId: "L1", kind: "stays", stayIds: ["S1", "S2"] }]);
});

test("a payout cannot arrive before Airbnb sent it", () => {
  assert.deepEqual(matchLines([line("L1", "2026-09-30", 1_893_667, "in")], [], [stay("S1", "2026-09-28", "2026-09-30", 1_893_667, "2026-10-01")], "IDR"), []);
});

// Real case (August 2026): stays imported without a payout date, paid one to three days after check-in.
test("without a payout date, a stay is paid shortly after check-in", () => {
  const out = matchLines([line("L1", "2026-08-24", 800_030, "in"), line("L2", "2026-08-23", 5_283_497, "in")], [],
    [stay("S1", "2026-08-21", "2026-08-22", 800_030), stay("S2", "2026-08-22", "2026-08-26", 5_283_497)], "IDR");
  assert.deepEqual(out.map((m) => m.lineId + (m.kind === "stays" ? m.stayIds.join() : "")).sort(), ["L1S1", "L2S2"]);
});

test("a long stay paid in two instalments links both lines", () => {
  const out = matchLines([line("L1", "2026-08-05", 25_378_973, "in"), line("L2", "2026-08-15", 2_048_659, "in"), line("L3", "2026-08-20", 1_246_384, "in")], [],
    [stay("S1", "2026-08-03", "2026-08-17", 27_427_632), stay("S2", "2026-08-19", "2026-08-20", 1_246_384)], "IDR");
  assert.deepEqual(out.map((m) => m.lineId + (m.kind === "stays" ? m.stayIds.join() : "")).sort(), ["L1S1", "L2S1", "L3S2"]);
});

