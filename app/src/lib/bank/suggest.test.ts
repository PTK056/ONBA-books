import { test } from "node:test";
import assert from "node:assert/strict";
import { amountGap, partRoom, scoreEntry } from "./suggest.ts";

const line = { date: "2026-10-10", amount: 350000, currency: "IDR", counterparty: "KADEK SURYANI", description: "TRF KE KADEK SURYANI" };
const entry = (over: Partial<{ date: string; amount: number; currency: string; amountReporting: number; description: string | null }>) =>
  ({ date: "2026-10-10", amount: 350000, currency: "IDR", amountReporting: 350000, description: "Petrol", ...over });

test("same amount, same day and the payee named: near-certain", () => {
  const r = scoreEntry(line, entry({ description: "Petrol – Suryani" }), "IDR", 10);
  assert.equal(r.score, 1);
  assert.deepEqual(r.reasons, ["same amount", "same day", "description names the payee"]);
});

test("a closer amount and date score higher", () => {
  const near = scoreEntry(line, entry({ date: "2026-10-09" }), "IDR", 10).score;
  const far = scoreEntry(line, entry({ date: "2026-10-01", amount: 356000, amountReporting: 356000 }), "IDR", 10).score;
  assert.ok(near > far, `${near} > ${far}`);
});

test("the gap is said in words", () => {
  const r = scoreEntry(line, entry({ amount: 357000, amountReporting: 357000, date: "2026-10-12" }), "IDR", 10);
  assert.deepEqual(r.reasons.slice(0, 2), ["amount differs by 7000 IDR (2%)", "entry dated 2d after"]);
});

test("a foreign-currency entry compares in the reporting currency, within one unit", () => {
  const r = scoreEntry(line, entry({ currency: "USD", amount: 21.875, amountReporting: 350000.4 }), "IDR", 10);
  assert.equal(r.gap, 0);
  assert.equal(r.reasons[0], "same amount");
});

test("two currencies that cannot be compared give no credit for the amount", () => {
  const usdLine = { ...line, currency: "USD", amount: 20 };
  const r = scoreEntry(usdLine, entry({ currency: "EUR", amount: 20, amountReporting: 350000 }), "IDR", 10);
  assert.equal(r.gap, null);
  assert.ok(r.score <= 0.45);
});

test("amountGap: exact in the same currency, relative otherwise", () => {
  assert.equal(amountGap(line, 350000, false), 0);
  assert.equal(amountGap(line, 315000, false), 0.1);
});

// Part payments: the same answers as bank_line_link in migration bank_part_payments (see tests/bank_parts.sql).
const lump = { date: "2025-05-01", amount: 1_000_000, currency: "IDR", amountReporting: 1_000_000, description: "Furnitures/ general" };
const idr = (amount: number) => ({ amount, currency: "IDR" });

test("a part payment fits in what is left, to the cent, in one currency", () => {
  assert.deepEqual(partRoom(idr(250_000), lump, [idr(300_000)], "IDR"), { fits: true, left: 700_000 });
  assert.deepEqual(partRoom(idr(450_000), lump, [idr(300_000), idr(250_000)], "IDR"), { fits: true, left: 450_000 });
  assert.equal(partRoom(idr(1), lump, [idr(300_000), idr(250_000), idr(450_000)], "IDR").fits, false);
  assert.equal(partRoom(idr(0.02), lump, [idr(999_999.99)], "IDR").fits, false);
  assert.equal(partRoom(idr(0.01), lump, [idr(999_999.99)], "IDR").fits, true);
});

test("a converted entry: lines in the reporting currency add up against its converted value", () => {
  const usd = { date: "2025-05-01", amount: 100, currency: "USD", amountReporting: 1_600_000, description: null };
  assert.deepEqual(partRoom(idr(800_000), usd, [idr(800_000)], "IDR"), { fits: true, left: 800_000 });
  assert.equal(partRoom(idr(1000), usd, [idr(800_000), idr(800_000)], "IDR").fits, false);
  // Mixing the entry's currency and converted amounts: shares of the entry, 0.01% over allowed.
  assert.equal(partRoom(idr(800_100), usd, [{ amount: 50, currency: "USD" }], "IDR").fits, true);
  assert.equal(partRoom(idr(801_000), usd, [{ amount: 50, currency: "USD" }], "IDR").fits, false);
  assert.deepEqual(partRoom(idr(1), usd, [{ amount: 50, currency: "USD" }], "IDR"), { fits: true, left: 800_000 });
});

test("currencies that cannot be added up never fit", () => {
  assert.deepEqual(partRoom({ amount: 10, currency: "EUR" }, lump, [idr(300_000)], "IDR"), { fits: false, left: null });
  assert.deepEqual(partRoom(idr(10), lump, [{ amount: 10, currency: "EUR" }], "IDR"), { fits: false, left: null });
});
