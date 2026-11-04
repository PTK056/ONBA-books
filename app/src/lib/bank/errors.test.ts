import { test } from "node:test";
import assert from "node:assert/strict";
import { bankErrorOf } from "./errors.ts";

test("a coded database error keeps its code and message", () => {
  const e = bankErrorOf("already_handled: This line was already handled (matched).");
  assert.equal(e.code, "already_handled");
  assert.equal(e.message, "This line was already handled (matched).");
});

test("the closed-month guard becomes month_closed", () => {
  assert.equal(bankErrorOf("Month 2026-10-01 is closed for this villa; record an adjustment in an open month instead").code, "month_closed");
});

test("anything else is a plain failure, without leaking the database text", () => {
  const e = bankErrorOf('insert or update on table "transactions" violates foreign key constraint');
  assert.equal(e.code, "failed");
  assert.doesNotMatch(e.message, /constraint/);
  assert.equal(bankErrorOf("unknown_code: text").code, "failed");
});
