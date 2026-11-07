import assert from "node:assert/strict";
import { test } from "node:test";
import { sameAsKnown, type NewLine } from "./dedupe.ts";

const row = (fingerprint: string, o: Partial<NewLine> = {}): NewLine =>
  ({ date: "2026-08-24", direction: "in", amount: 800030, balance: 214153645.64, fingerprint, ...o });

test("the same line read again with other words is known by its balance", () => {
  const known = [row("2026-08-24|in|800030.00|••••2035|name:Airbnb Payments UK Lim|1")];
  assert.deepEqual(sameAsKnown([row("2026-08-24|in|800030.00|••••2035|Airbnb Payments UK Lim|1")], known), []);
});

test("a line with the same fingerprint is left to the upsert, which skips it", () => {
  const known = [row("a")];
  assert.deepEqual(sameAsKnown([row("a")], known).map((r) => r.fingerprint), ["a"]);
});

test("two identical payments the same day are two lines; one known means one new", () => {
  const known = [row("a", { balance: 100 })];
  const rows = [row("a", { balance: 100 }), row("b", { balance: 100 }), row("c", { balance: 90 })];
  // "a" is the known one; "b" has a balance no other known line has left; "c" is new.
  assert.deepEqual(sameAsKnown(rows, known).map((r) => r.fingerprint), ["a", "b", "c"]);
  assert.deepEqual(sameAsKnown([row("x", { balance: 100 }), row("y", { balance: 100 })], known).map((r) => r.fingerprint), ["y"]);
});

test("without a running balance (Wise payments), only the fingerprint counts", () => {
  assert.deepEqual(sameAsKnown([row("b", { balance: null })], [row("a", { balance: null })]).map((r) => r.fingerprint), ["b"]);
});
