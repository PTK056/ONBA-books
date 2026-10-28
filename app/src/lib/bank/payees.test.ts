// node --test src/lib/bank/payees.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { last4, payeeKey } from "./payees.ts";

test("a payee is known by the account's last 4 digits, else by name", () => {
  assert.equal(payeeKey({ description: "Transfer · I MADE JIWA", counterparty: "I MADE JIWA", payee_last4: "5466" }), "acct:5466");
  assert.equal(payeeKey({ description: "Transfer · I MADE JIWA", counterparty: "I MADE JIWA" }), "name:jiwa");
  assert.equal(payeeKey({ description: "Card · Toko Dapur Pelita BADUNG", counterparty: "Toko Dapur Pelita BADUNG" }), "name:dapur-pelita");
});

test("bank charges and nameless lines are not payees", () => {
  assert.equal(payeeKey({ description: "Wise fee · I MADE JIWA", counterparty: "Wise" }), null);
  assert.equal(payeeKey({ description: "PCM", counterparty: null }), null);
});

test("only the last 4 digits of an account are kept", () => {
  assert.equal(last4("(80017) 1450017035466"), "5466");
  assert.equal(last4("(140397) 7700427417"), "7417");
  assert.equal(last4(""), null);
});
