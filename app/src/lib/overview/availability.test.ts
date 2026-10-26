import { test } from "node:test";
import assert from "node:assert/strict";
import { availableNights } from "./availability.ts";

test("no nights before the villa's first booking", () => {
  assert.equal(availableNights("2025-04", "2025-06-07"), 0);
  assert.equal(availableNights("2025-05", "2025-06-07"), 0);
});

test("opening month counts from the first booked night", () => {
  assert.equal(availableNights("2025-06", "2025-06-07"), 24); // 7 → 30 June
  assert.equal(availableNights("2025-06", "2025-06-01"), 30);
});

test("whole months after opening", () => {
  assert.equal(availableNights("2025-07", "2025-06-07"), 31);
  assert.equal(availableNights("2026-02", "2025-06-07"), 28);
});

test("a villa never booked is not on the market", () => {
  assert.equal(availableNights("2026-10", undefined), 0);
});
