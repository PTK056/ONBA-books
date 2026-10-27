// Reads a bank statement PDF with the app's reader and prints a summary (lines are written to a JSON file next to it).
// node scripts/read-statement.mts <statement.pdf>     (key from ~/.config/onbabooks/anthropic_key)

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { readStatementPdf } from "../src/lib/bank/statement-pdf.ts";

const file = process.argv[2];
if (!file) throw new Error("usage: node scripts/read-statement.mts <statement.pdf>");
const apiKey = process.env.ANTHROPIC_API_KEY ?? readFileSync(`${homedir()}/.config/onbabooks/anthropic_key`, "utf8").trim();

const started = Date.now();
const s = await readStatementPdf(new Anthropic({ apiKey }), readFileSync(file).toString("base64"));
writeFileSync(file.replace(/\.pdf$/i, ".lines.json"), JSON.stringify(s, null, 2));
const total = (d: "in" | "out") => s.lines.filter((l) => l.direction === d).reduce((a, l) => a + l.amount, 0);
console.log({
  seconds: Math.round((Date.now() - started) / 1000), bank: s.bank, currency: s.currency, account: s.account_last4 && `••••${s.account_last4}`,
  period: `${s.period_start} → ${s.period_end}`, lines: s.lines.length, in: total("in"), out: total("out"),
  opening: s.opening_balance, closing: s.closing_balance, balanced: s.balanced, notes: s.notes,
});
