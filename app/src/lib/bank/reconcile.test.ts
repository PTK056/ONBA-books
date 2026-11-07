// node --test src/lib/bank/   (the cases are the ones met on real statements, anonymised)

import assert from "node:assert/strict";
import { test } from "node:test";
import { cancelGroups, cancelSets, feeLineOf, feePairs, guessLine, WEAK, type BookedEntry, type OpenLine, type StayToPay } from "./reconcile.ts";

let n = 0;
const line = (o: Partial<OpenLine>): OpenLine => ({
  id: `L${++n}`, accountId: "danamon", date: "2026-06-26", direction: "out", amount: 600000, currency: "IDR",
  counterparty: null, description: "PCM", reference: null, ...o,
});
const entry = (o: Partial<BookedEntry>): BookedEntry => ({
  id: `E${++n}`, date: "2026-06-26", direction: "out", amount: 600000, currency: "IDR", amountReporting: 600000,
  description: "Pool maintenance", category: "Pool", villa: "Casa", paidBy: [], ...o,
});
const stay = (o: Partial<StayToPay>): StayToPay => ({
  id: `S${++n}`, guest: "Christina", platform: "direct", checkIn: "2026-03-28", checkOut: "2026-05-09", net: 60000000, paid: 0, lines: 0, ...o,
});

test("same amount, same day: the best guess, with its reasons", () => {
  const l = line({});
  const e = entry({});
  const [g] = guessLine(l, [l], [e], [], "IDR");
  assert.equal(g.kind, "entry");
  assert.ok(g.score >= 0.85);
  assert.deepEqual(g.reasons, ["same amount", "same day"]);
});

test("a bill paid a month late is still offered, below this month's", () => {
  const l = line({});
  const june = entry({}), may = entry({ date: "2026-05-26" }), long = entry({ date: "2026-03-01" });
  const gs = guessLine(l, [l], [may, june, long], [], "IDR");
  assert.deepEqual(gs.map((g) => g.kind === "entry" && g.entryId), [june.id, may.id]);
  assert.deepEqual(gs[1].reasons, ["same amount", "booked 31 days before", "only if no earlier bank line paid it"]);
  assert.ok(gs[1].score <= WEAK, "last month's entry is never the first choice: this line may be this month's");
});

test("a few percent off is offered with the difference; further off is not", () => {
  const l = line({ amount: 3153313 });
  const close = entry({ amount: 3196200, amountReporting: 3196200, date: "2026-06-20" });
  const far = entry({ amount: 3600000, amountReporting: 3600000 });
  const gs = guessLine(l, [l], [close, far], [], "IDR");
  assert.equal(gs.length, 1);
  assert.match(gs[0].reasons[0], /^amount differs by 42,887 IDR \(1\.4%\)$/);
});

test("an entry naming another line's payee is left to that line", () => {
  const a = line({ counterparty: "GLOBALXTREME", description: "Transfer" });
  const b = line({ counterparty: "PLN", description: "Transfer" });
  const internet = entry({ description: "Globalxtreme internet" });
  assert.equal(guessLine(b, [a, b], [internet], [], "IDR").length, 0);
  assert.ok(guessLine(a, [a, b], [internet], [], "IDR")[0].reasons.includes("names the payee"));
});

test("a Wise transfer and its fee make the receipt's total", () => {
  const pay = line({ accountId: "wise", date: "2026-05-11", amount: 215000, counterparty: "raja niaga", description: "Transfer · raja niaga", reference: "TRANSFER-1" });
  const fee = line({ accountId: "wise", date: "2026-05-11", amount: 12804, counterparty: "Wise", description: "Wise fee · raja niaga", reference: "TRANSFER-1 fee" });
  const receipt = entry({ date: "2026-05-11", amount: 227804, amountReporting: 227804, description: "shower head" });
  assert.equal(feeLineOf(pay, [pay, fee])?.id, fee.id);
  assert.equal(feeLineOf(fee, [pay, fee]), null, "a fee has no fee");
  const [g] = guessLine(pay, [pay, fee], [receipt], [], "IDR");
  assert.ok(g.kind === "entry" && g.withLines[0] === fee.id);
  assert.equal(g.reasons[0], "with its Wise fee (12,804), the same total");
  assert.ok(g.score >= 0.85);
});

test("without a reference, the fee naming the payee is the one", () => {
  const pay = line({ accountId: "wise", amount: 150000, counterparty: "imade Ristawan", description: "Transfer" });
  const fee = line({ accountId: "wise", amount: 6458, counterparty: "Wise", description: "Wise fee · imade Ristawan" });
  const other = line({ accountId: "wise", amount: 6458, counterparty: "Wise", description: "Wise fee · dodik sofyan" });
  assert.equal(feeLineOf(pay, [pay, fee, other])?.id, fee.id);
});

test("a transfer sent back cancels out: in, out, closest first", () => {
  const sent = line({ date: "2026-06-26", amount: 2250000 });
  const back = line({ date: "2026-06-29", direction: "in", amount: 2250000, description: "KAMI SENDIRI MANDIRI SKN" });
  const again = line({ date: "2026-06-30", amount: 2250000 });
  const groups = cancelGroups(back, [sent, back, again]);
  assert.deepEqual(groups.map((g) => g.lineIds), [[back.id, again.id], [back.id, sent.id]]);
  const [g] = guessLine(back, [sent, back, again], [], [], "IDR");
  assert.equal(g.kind, "cancel");
  assert.deepEqual(g.reasons, ["the same money went out on Jun 30: a transfer sent back?"]);
  assert.ok(g.score > WEAK && g.score < 0.85, "offered first, but an unnamed pair is never as sure as a named one");
});

test("sent back with the Wise fee refunded too: three lines cancel out", () => {
  const pay = line({ accountId: "wise", date: "2026-04-14", amount: 3196800, counterparty: "PIERRE K", description: "Transfer", reference: "T9" });
  const fee = line({ accountId: "wise", date: "2026-04-14", amount: 12804, counterparty: "Wise", description: "Wise fee · PIERRE K", reference: "T9 fee" });
  const refund = line({ accountId: "wise", date: "2026-04-16", direction: "in", amount: 3209604, counterparty: "PIERRE K", description: "Received" });
  const [g] = cancelGroups(refund, [pay, fee, refund]);
  assert.deepEqual(g.lineIds, [refund.id, pay.id, fee.id]);
  assert.ok(g.named, "both name the payee");
  const [s] = cancelSets([pay, fee, refund]);
  assert.ok(s.sure && /with the Wise fee: the lines cancel out, nothing to book\.$/.test(s.why));
});

test("money in another account, or weeks later, does not cancel", () => {
  const sent = line({ amount: 900000 });
  assert.equal(cancelGroups(sent, [sent, line({ direction: "in", amount: 900000, accountId: "wise" })]).length, 0);
  assert.equal(cancelGroups(sent, [sent, line({ direction: "in", amount: 900000, date: "2026-07-20" })]).length, 0);
});

test("one more payment of a purchase paid in parts, and the last one", () => {
  const l = line({ date: "2025-05-25", amount: 300000, counterparty: "andre yudha", description: "Transfer" });
  const furniture = entry({ date: "2025-05-01", amount: 1000000, amountReporting: 1000000, description: "Furnitures",
    paidBy: [{ amount: 400000, currency: "IDR" }] });
  const [g] = guessLine(l, [l], [furniture], [], "IDR");
  assert.ok(g.kind === "entry" && g.part);
  assert.equal(g.reasons[0], "paid in part by 1 bank line, 600,000 IDR left");
  const last = line({ date: "2025-05-25", amount: 600000 });
  const [h] = guessLine(last, [last], [furniture], [], "IDR");
  assert.ok(h.reasons.includes("this line pays what is left"));
  assert.ok(h.score > g.score && h.score > WEAK && g.score <= WEAK, "only the last payment is a first choice");
  const tooMuch = line({ date: "2025-05-25", amount: 700000 });
  assert.equal(guessLine(tooMuch, [tooMuch], [furniture], [], "IDR").length, 0, "never more than what is left");
});

test("a guest paying a long stay in instalments, named in the transfer", () => {
  const deposit = line({ direction: "in", date: "2026-02-05", amount: 18500000, counterparty: "Christina Lee Mollenhauer", description: "Received" });
  const christina = stay({});
  const someone = stay({ guest: "Julian", checkIn: "2026-02-10", checkOut: "2026-02-15", net: 5000000 });
  const gs = guessLine(deposit, [deposit], [], [christina, someone], "IDR");
  assert.ok(gs[0].kind === "stay" && gs[0].stayId === christina.id);
  assert.deepEqual(gs[0].reasons, ["the transfer names the guest", "part of the stay (60,000,000 IDR not paid yet)", "51 days before arrival"]);
  // The last of three pays what is left.
  const last = line({ direction: "in", date: "2026-04-09", amount: 20000000, counterparty: "Christina Lee Mollenhauer", description: "Received" });
  const [g] = guessLine(last, [last], [], [stay({ id: christina.id, paid: 40000000, lines: 2 })], "IDR");
  assert.ok(g.reasons.includes("pays what is left of the stay") && g.reasons.includes("2 bank lines already pay it"));
});

test("an Airbnb payout: the stay whose net it is, just after arrival", () => {
  const payout = line({ direction: "in", date: "2026-08-24", amount: 800030, counterparty: "Airbnb Payments UK Lim", description: "Airbnb" });
  const asta = stay({ guest: "Asta", checkIn: "2026-08-21", checkOut: "2026-08-23", net: 800030 });
  const later = stay({ guest: "Julian", checkIn: "2026-08-28", checkOut: "2026-09-05", net: 15355463 });
  const gs = guessLine(payout, [payout], [], [asta, later], "IDR");
  assert.ok(gs[0].kind === "stay" && gs[0].stayId === asta.id && gs[0].reasons.includes("same as the stay's net"));
});

test("automatic: a transfer and its fee that are exactly one entry, and only one", () => {
  const pay = line({ accountId: "wise", date: "2026-05-11", amount: 215000, counterparty: "raja niaga", description: "Transfer", reference: "T1" });
  const fee = line({ accountId: "wise", date: "2026-05-11", amount: 12804, counterparty: "Wise", description: "Wise fee · raja niaga", reference: "T1 fee" });
  const receipt = entry({ date: "2026-05-10", amount: 227804, amountReporting: 227804, description: "shower head" });
  const none = { lines: new Set<string>(), entries: new Set<string>() };
  assert.deepEqual(feePairs([pay, fee], [receipt], none, "IDR"), [{ lineIds: [pay.id, fee.id], transactionId: receipt.id }]);
  // Two receipts of that total as close: a person chooses.
  const twin = entry({ date: "2026-05-12", amount: 227804, amountReporting: 227804, description: "shower head" });
  assert.deepEqual(feePairs([pay, fee], [receipt, twin], none, "IDR"), []);
  // One rupiah off, or the entry already taken: nothing.
  assert.deepEqual(feePairs([pay, fee], [entry({ date: "2026-05-11", amount: 227805, amountReporting: 227805 })], none, "IDR"), []);
  assert.deepEqual(feePairs([pay, fee], [receipt], { lines: new Set(), entries: new Set([receipt.id]) }, "IDR"), []);
  assert.deepEqual(feePairs([pay, fee], [receipt], { lines: new Set([pay.id]), entries: new Set() }, "IDR"), []);
});

test("for Sply: sets that cancel out with no doubt only", () => {
  const sent = line({ date: "2026-07-28", amount: 900000 });
  const back = line({ date: "2026-07-28", direction: "in", amount: 900000, description: "KAMI SENDIRI BCA SKN" });
  const sets = cancelSets([sent, back, line({ amount: 5000 })]);
  assert.deepEqual(sets.map((x) => x.lineIds), [[sent.id, back.id]]);
  assert.equal(sets[0].why, "900,000 IDR went out on Jul 28 and came back on Jul 28: the lines cancel out, nothing to book (same amount; check it is the same money).");
  assert.equal(sets[0].sure, false, "nothing ties the two lines but the amount: Sply proposes it, never as sure");
  // Out on the 26th, back on the 29th, out again on the 30th: the money back goes with the closest, the 30th.
  const a = line({ date: "2026-06-26", amount: 2250000 }), b = line({ date: "2026-06-29", direction: "in", amount: 2250000 }),
    c = line({ date: "2026-06-30", amount: 2250000 });
  assert.deepEqual(cancelSets([a, b, c]).map((x) => x.lineIds), [[b.id, c.id]]);
  // Two identical payments the same day and one back: not sure which.
  const p1 = line({ amount: 600000 }), p2 = line({ amount: 600000 }), r = line({ direction: "in", amount: 600000 });
  assert.deepEqual(cancelSets([p1, p2, r]), []);
});

test("two unrelated transfers of one amount are never sure, whatever the bank's wording", () => {
  const pay = line({ amount: 5000000, counterparty: "PT TIRTA POOL", description: "TRSF E-BANKING DB 0311/FTSCY/WS95031 PT TIRTA POOL" });
  const deposit = line({ date: "2026-06-29", direction: "in", amount: 5000000, counterparty: "JOHN SMITH",
    description: "TRSF E-BANKING CR 0311/FTSCY/WS95031 JOHN SMITH" });
  const [set] = cancelSets([pay, deposit]);
  assert.equal(set.sure, false);
  const [g] = guessLine(pay, [pay, deposit], [], [], "IDR");
  assert.ok(g.kind === "cancel" && g.score < 0.85 && !g.reasons.includes("both lines name the same payee"));
});
