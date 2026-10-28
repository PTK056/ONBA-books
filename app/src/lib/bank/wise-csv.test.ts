// node --test src/lib/bank/wise-csv.test.ts   (synthetic rows shaped like a real Wise export)

import assert from "node:assert/strict";
import { test } from "node:test";
import { isWiseCsv, parseWiseCsv } from "./wise-csv.ts";

const HEADER = `"TransferWise ID",Date,"Date Time",Amount,Currency,Description,"Payment Reference","Running Balance","Exchange From","Exchange To","Exchange Rate","Payer Name","Payee Name","Payee Account Number",Merchant,"Card Last Four Digits","Card Holder Full Name",Attachment,Note,"Total fees","Exchange To Amount","Transaction Type","Transaction Details Type"`;
const csv = [
  HEADER,
  // Newest first, as Wise exports.
  `TRANSFER-3,27-10-2026,"27-10-2026 17:16:16.494",-131458.00,IDR,"Argent envoyé à NYOMAN",Deposit,862292.00,,,,,"NYOMAN","(140397) 7700427417",,,,,,6458.00,,DEBIT,TRANSFER`,
  `CARD-2,25-10-2026,"25-10-2026 14:26:15.758",-830000.00,IDR,"Transaction de carte",,993750.00,,,,,,,"Toko Dapur Pelita BADUNG",5884,"PIERRE",,,0.00,,DEBIT,CARD`,
  `DEPOSIT-1,20-10-2026,"20-10-2026 09:00:00.000",1500000.00,IDR,"Received",548260,1823750.00,,,,"Abdullah",,,,,,,,0.00,,CREDIT,DEPOSIT`,
].join("\n");

test("recognises a Wise export", () => {
  assert.ok(isWiseCsv(csv));
  assert.ok(!isWiseCsv("Date,Type,Confirmation Code\n"));
});

test("a transfer with a fee becomes the payment and the Wise fee", () => {
  const s = parseWiseCsv(csv, "statement_120661494_IDR_2025-04-01_2026-10-28.csv");
  assert.equal(s.lines.length, 4);
  assert.deepEqual(s.lines.map((l) => [l.date, l.direction, l.amount]), [
    ["2026-10-20", "in", 1500000], ["2026-10-25", "out", 830000], ["2026-10-27", "out", 125000], ["2026-10-27", "out", 6458],
  ]);
  assert.equal(s.lines[2].counterparty, "NYOMAN");
  assert.match(s.lines[3].description, /Wise fee/);
});

test("balances add up, account named from the file, no account number kept", () => {
  const s = parseWiseCsv(csv, "statement_120661494_IDR_2025-04-01_2026-10-28.csv");
  assert.equal(s.opening_balance, 323750);
  assert.equal(s.closing_balance, 862292);
  assert.equal(s.balanced, true);
  assert.equal(s.account_last4, "1494");
  assert.ok(!JSON.stringify(s).includes("7700427417"));
});
