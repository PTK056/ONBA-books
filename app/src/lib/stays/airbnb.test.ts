// node --test src/lib/stays/   (synthetic data shaped like a real Airbnb transaction history)

import assert from "node:assert/strict";
import { test } from "node:test";
import { allocateByNights, parseAirbnbCsv, readCsv } from "./airbnb.ts";

const HEADER = "Date,Arriving by date,Type,Confirmation Code,Booking date,Start date,End date,Nights,Guest,Listing,Details,Reference code,Currency,Amount,Paid out,Service fee,Fast pay fee,Cleaning fee,Gross earnings,Airbnb remitted tax,Earnings year";
const L = "Villa Test - 2BR";
const csv = "\uFEFF" + [
  HEADER,
  // One payout for two bookings, one of them refunded to the guest.
  `09/21/2026,09/22/2026,Payout,,,,,,,,"Transfer to PT Test, 1234 (IDR)",REF1,IDR,,1893667.00,,,,,,`,
  `09/21/2026,,Reservation,HMAAA,09/17/2026,09/18/2026,09/21/2026,3,Ana,${L},,,EUR,191.78,,39.41,,0.00,231.19,0.00,2026`,
  `09/21/2026,,Resolution Adjustment,HMAAA,09/17/2026,09/18/2026,09/21/2026,3,Ana,${L},Resolution adjustment,,EUR,-191.77,,,,,-191.77,,2026`,
  `09/21/2026,,Reservation,HMBBB,09/10/2026,09/18/2026,09/20/2026,2,Ben,${L},,,EUR,92.88,,19.10,,0.00,111.98,0.00,2026`,
  // A stay across two months.
  `08/31/2026,09/01/2026,Payout,,,,,,,,Transfer,REF2,IDR,,15355463.00,,,,,,`,
  `08/31/2026,,Reservation,HMCCC,08/01/2026,08/28/2026,09/05/2026,8,Cleo,${L},,,EUR,746.55,,153.45,,0.00,900.00,0.00,2026`,
  // A long stay paid in two instalments.
  `08/15/2026,08/16/2026,Payout,,,,,,,,Transfer,REF3,IDR,,2048659.00,,,,,,`,
  `08/15/2026,,Reservation,HMDDD,07/01/2026,08/03/2026,08/17/2026,14,Dan,${L},,,EUR,99.29,,20.41,,0.00,119.70,0.00,2026`,
  `08/04/2026,08/05/2026,Payout,,,,,,,,Transfer,REF4,IDR,,25000000.00,,,,,,`,
  `08/04/2026,,Reservation,HMDDD,07/01/2026,08/03/2026,08/17/2026,14,Dan,${L},,,EUR,1227.33,,252.27,,0.00,1479.60,0.00,2026`,
  // An adjustment without gross, and a booking priced in IDR.
  `02/05/2026,02/06/2026,Payout,,,,,,,,Transfer,REF5,IDR,,5465000.00,,,,,,`,
  `02/05/2026,,Adjustment,HMEEE,12/01/2025,12/31/2025,01/02/2026,2,Eve,${L},,,EUR,-476.55,,16.26,,,,,2026`,
  `01/01/2026,01/02/2026,Payout,,,,,,,,Transfer,REF6,IDR,,14915000.00,,,,,,`,
  `01/01/2026,,Reservation,HMEEE,12/01/2025,12/31/2025,01/02/2026,2,Eve,${L},,,EUR,752.04,,25.66,,0.00,777.70,0.00,2026`,
  `11/24/2025,11/25/2025,Payout,,,,,,,,Transfer,REF7,IDR,,541472.00,,,,,,`,
  `11/24/2025,,Reservation,HMFFF,11/20/2025,11/22/2025,11/23/2025,1,"Fay, Jr.",${L},,,IDR,541472.00,,"18,489.00",,0.00,560000.00,0.00,2025`,
].join("\r\n");

const stays = Object.fromEntries(parseAirbnbCsv(csv).stays.map((s) => [s.code, s]));

test("reads quoted fields, doubled quotes and the BOM", () => {
  const rows = readCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\n');
  assert.deepEqual(rows, [{ a: "x, y", b: 'say "hi"' }]);
});

test("groups lines by booking and keeps net = gross - fees", () => {
  assert.equal(Object.keys(stays).length, 6);
  for (const s of Object.values(stays)) assert.equal(Math.round((s.gross - s.fees) * 100) / 100, s.net);
  assert.deepEqual([stays.HMDDD.gross, stays.HMDDD.fees, stays.HMDDD.net], [1599.3, 272.68, 1326.62]);
  assert.equal(stays.HMFFF.guest, "Fay, Jr.");
});

test("derives the rate from the payout that paid the lines", () => {
  // 1,893,667 IDR for 191.78 - 191.77 + 92.88 EUR
  assert.equal(Math.round(stays.HMBBB.payoutRates.IDR), Math.round(1893667 / 92.89));
  assert.equal(stays.HMFFF.payoutRates.IDR, 1); // booked in IDR
});

test("handles refunds and adjustments", () => {
  assert.equal(stays.HMAAA.net, 0.01);
  assert.ok(parseAirbnbCsv(csv).warnings.some((w) => w.startsWith("HMAAA: refunded")));
  // Adjustment: -476.55 net with the 16.26 fee refunded → gross -492.81
  assert.deepEqual([stays.HMEEE.gross, stays.HMEEE.fees], [284.89, 9.4]);
});

test("splits a stay across months by nights, to the cent", () => {
  const lines = allocateByNights(stays.HMCCC, 20568.6);
  assert.deepEqual(lines.map((l) => [l.date, l.direction, l.amount]), [
    ["2026-08-28", "in", 450], ["2026-08-28", "out", 76.72],
    ["2026-09-01", "in", 450], ["2026-09-01", "out", 76.73],
  ]);
  assert.ok(lines[0].description.includes("4 of 8 nights"));
});

test("allocated lines always add up to the stay", () => {
  for (const s of Object.values(stays)) {
    const lines = allocateByNights(s, 1);
    const sum = (d: string) => Math.round(lines.filter((l) => l.direction === d).reduce((a, l) => a + l.amount, 0) * 100) / 100;
    assert.equal(sum("in"), s.gross);
    assert.equal(sum("out"), s.fees);
    assert.ok(lines.every((l) => l.amount > 0));
  }
});

test("rejects files that are not an Airbnb transaction history", () => {
  const r = parseAirbnbCsv("Confirmation code,Status,Guest name\nHMX,Confirmed,Ana\n");
  assert.equal(r.stays.length, 0);
  assert.match(r.warnings[0], /doesn't look like an Airbnb transaction history/);
});
