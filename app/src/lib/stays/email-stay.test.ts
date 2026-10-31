// node --test src/lib/stays/   (figures from the real e-mails, anonymised)

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Canceled, Confirmed } from "./airbnb-email.ts";
import { receivedShares, stayFromEmails, type PaidLine } from "./email-stay.ts";

const booking = (over: Partial<Confirmed> = {}): Confirmed => ({
  kind: "confirmed", code: "HMAAAA0001", guest: "Jane Walker", listingId: "1", listing: "VILLA",
  checkIn: "2026-10-30", checkOut: "2026-11-06", nights: 7, currency: "EUR", gross: 512.55, fees: 87.4, net: 425.15, ...over,
});
const paid = (amount: number, received: number, over: Partial<PaidLine> = {}): PaidLine => ({
  amount, currency: "EUR", received, receivedCurrency: "IDR", checkIn: "2026-10-30", checkOut: "2026-11-06", sentOn: "2026-10-31", ...over,
});

test("booked, not paid yet: amounts from the confirmation, no rate", () => {
  const r = stayFromEmails(booking(), [], null);
  assert.deepEqual([r.stay.gross, r.stay.fees, r.stay.net, r.status, r.paid, r.feesEstimated], [512.55, 87.4, 425.15, "confirmed", false, false]);
  assert.deepEqual(r.stay.payoutRates, {});
  assert.equal(r.stay.payoutDate, null);
});

test("paid: the payout gives the real rate", () => {
  const r = stayFromEmails(booking(), [paid(425.15, 8_600_000)], null);
  assert.equal(r.paid, true);
  assert.equal(r.stay.payoutDate, "2026-10-31");
  assert.ok(Math.abs(r.stay.payoutRates.IDR - 8_600_000 / 425.15) < 1e-9);
  assert.equal(r.stay.gross, 512.55);
});

test("a night added after booking: second payout, new checkout, extra fee estimated", () => {
  // Real case: 12 nights booked (890.87 net), one more night accepted, paid 74.26 net separately.
  const b = booking({ checkIn: "2026-09-29", checkOut: "2026-10-11", nights: 12, gross: 1074.05, fees: 183.18, net: 890.87 });
  const r = stayFromEmails(b, [
    paid(890.87, 18_096_227, { checkIn: "2026-09-29", checkOut: "2026-10-11", sentOn: "2026-09-30" }),
    paid(74.26, 1_491_758, { checkIn: "2026-09-29", checkOut: "2026-10-12", sentOn: "2026-10-06" }),
  ], null);
  assert.deepEqual([r.stay.checkOut, r.stay.nights, r.stay.net, r.paid, r.feesEstimated], ["2026-10-12", 13, 965.13, true, true]);
  assert.ok(r.stay.gross > 1074.05 + 74.26 && r.stay.fees > 183.18);
  assert.ok(Math.abs(r.stay.payoutRates.IDR - (18_096_227 + 1_491_758) / 965.13) < 1e-9, "one rate over both payouts");
  assert.equal(r.stay.payoutDate, "2026-10-06");
});

test("canceled by the guest: only what the host keeps, fees at the booking's share", () => {
  const canceled: Canceled = { kind: "canceled", code: "HMAAAA0001", kept: 191.78, currency: "EUR" };
  // Booking with the same fee share as the real case (39.41 / 231.19).
  const b = booking({ gross: 462.38, fees: 78.82, net: 383.56 });
  const r = stayFromEmails(b, [], canceled);
  assert.equal(r.status, "canceled");
  assert.equal(r.stay.net, 191.78);
  assert.ok(Math.abs(r.stay.gross - 231.19) <= 0.02, `gross ${r.stay.gross}`);
  const none = stayFromEmails(b, [], { ...canceled, kept: 0 });
  assert.deepEqual([none.stay.gross, none.stay.fees, none.feesEstimated], [0, 0, false]);
});

test("canceled then paid out: the payout is the exact amount kept", () => {
  const r = stayFromEmails(booking(), [paid(191.5, 3_900_000)], { kind: "canceled", code: "HMAAAA0001", kept: 191.78, currency: "EUR" });
  assert.equal(r.stay.net, 191.5);
  assert.equal(r.paid, true);
});

test("payout shares add up to the total", () => {
  assert.deepEqual(receivedShares([{ amount: 95.88 }], 1_938_587), [1_938_587]);
  const s = receivedShares([{ amount: 100 }, { amount: 200 }], 1000);
  assert.equal(s[0] + s[1], 1000);
});
