// node --test src/lib/bank/match.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { matchLines, mentions, nameTokens, type BankLineIn, type BookEntry, type StayNet } from "./match.ts";

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


// Real case (direct booking): half when booking, the rest on arrival, then an extension; the stay's net is the sum.
test("a direct booking paid as deposit, balance on arrival and an extension links all three", () => {
  const out = matchLines(
    [line("L1", "2026-02-05", 18_500_000, "in"), line("L2", "2026-03-28", 21_500_000, "in"), line("L3", "2026-04-09", 20_000_000, "in"), line("L4", "2026-05-09", 320_000, "in")],
    [], [stay("S1", "2026-03-28", "2026-05-10", 60_000_000)], "IDR");
  assert.deepEqual(out.map((m) => m.lineId).sort(), ["L1", "L2", "L3"]);
});

test("two combinations that add up: left for a person", () => {
  const out = matchLines(
    [line("L1", "2026-03-01", 500, "in"), line("L2", "2026-03-02", 500, "in"), line("L3", "2026-03-03", 500, "in")],
    [], [stay("S1", "2026-03-10", "2026-03-12", 1000)], "IDR");
  assert.deepEqual(out, []);
});

test("only distinctive names count", () => {
  assert.deepEqual(nameTokens("Wise fee · I MADE JIWA"), ["jiwa"]);
  assert.deepEqual(nameTokens("NYOMAN WISTRI MAWATI"), ["wistri", "mawati"]);
  assert.ok(mentions("Frais Wise – transfert #2446401555 (white stones, sulami)", nameTokens("Wise fee · sulami")));
  assert.ok(!mentions("Frais Wise – transfert (white stones, sulami)", nameTokens("Wise fee · I MADE JIWA")));
  assert.ok(!mentions("Salary I Made Ristawan", nameTokens("I MADE JIWA")));
});

// Real case (October 2026): three Wise fees of 6,458 the same days; the books' entry names "sulami".
test("an entry naming the payee goes to that line, not to another line of the same amount", () => {
  const lines = [
    { ...line("F1", "2026-10-22", 6458), text: "Wise fee · sulami" },
    { ...line("F2", "2026-10-22", 6458), text: "Wise fee · NYOMAN WISTRI MAWATI" },
    { ...line("F3", "2026-10-24", 6458), text: "Wise fee · I MADE JIWA" },
  ];
  const fee = { ...entry("T1", "2026-10-22", 6458), description: "Frais Wise – transfert #2446401555 (white stones, sulami)" };
  assert.deepEqual(matchLines(lines, [fee], [], "IDR"), [{ lineId: "F1", kind: "transaction", transactionId: "T1" }]);
});

test("payouts read from e-mails: exact amount, up to a few days after the date Airbnb gives", () => {
  // Real case: Beck's payout sent 31 Oct, Rp 8,643,874, should arrive by 6 Nov.
  const beck = { key: "P1|HMAAAA0001", stayId: "S1", sentOn: "2026-10-31", arrivesBy: "2026-11-06", received: 8_643_874 };
  assert.deepEqual(matchLines([line("L1", "2026-11-05", 8_643_874, "in")], [], [], "IDR", [beck]),
    [{ lineId: "L1", kind: "stays", stayIds: ["S1"] }]);
  assert.deepEqual(matchLines([line("L1", "2026-11-09", 8_643_874, "in")], [], [], "IDR", [beck]).length, 1, "a weekend after the date");
  assert.deepEqual(matchLines([line("L1", "2026-11-12", 8_643_874, "in")], [], [], "IDR", [beck]), [], "too late");
  assert.deepEqual(matchLines([line("L1", "2026-10-30", 8_643_874, "in")], [], [], "IDR", [beck]), [], "before it was sent");
  assert.deepEqual(matchLines([line("L1", "2026-11-05", 8_600_000, "in")], [], [], "IDR", [beck]), [], "another amount");
});

test("a night added after booking is a second payout of the same stay", () => {
  const first = { key: "P1|HMAAAA0004", stayId: "S4", sentOn: "2026-09-30", arrivesBy: "2026-10-07", received: 18_096_227 };
  const extra = { key: "P2|HMAAAA0004", stayId: "S4", sentOn: "2026-10-06", arrivesBy: "2026-10-13", received: 1_491_758 };
  const out = matchLines([line("L1", "2026-10-02", 18_096_227, "in"), line("L2", "2026-10-08", 1_491_758, "in")], [], [], "IDR", [first, extra]);
  assert.deepEqual(out, [{ lineId: "L1", kind: "stays", stayIds: ["S4"] }, { lineId: "L2", kind: "stays", stayIds: ["S4"] }]);
});

test("two payouts of the same amount in the same days: left for a person", () => {
  const a = { key: "P1|A", stayId: "SA", sentOn: "2026-10-01", arrivesBy: "2026-10-08", received: 1_000_000 };
  const b = { key: "P2|B", stayId: "SB", sentOn: "2026-10-01", arrivesBy: "2026-10-08", received: 1_000_000 };
  assert.deepEqual(matchLines([line("L1", "2026-10-03", 1_000_000, "in")], [], [], "IDR", [a, b]), []);
});
