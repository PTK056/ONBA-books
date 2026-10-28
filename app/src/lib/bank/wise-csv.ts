// Reads a Wise statement export (CSV, one currency) into the same shape as a statement read from a PDF.
// No AI: the file is structured. Wise includes its own fee in the amount debited, so each line with a fee
// becomes two lines: the payment itself (what the books record) and the Wise fee (a bank charge).

import { readCsv } from "../stays/airbnb.ts";
import { mask, type Statement, type StatementLine } from "./statement-pdf.ts";

const REQUIRED = ["TransferWise ID", "Date", "Amount", "Currency", "Running Balance"];

export class WiseCsvError extends Error {}

export function isWiseCsv(text: string): boolean {
  const header = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  return REQUIRED.every((h) => header.includes(h));
}

/** fileName: Wise names exports statement_<balance id>_<CUR>_<from>_<to>.csv; its last 4 digits name the account. */
export function parseWiseCsv(text: string, fileName = ""): Statement {
  if (!isWiseCsv(text)) throw new WiseCsvError("This is not a Wise statement export (CSV).");
  const rows = readCsv(text);
  const currencies = [...new Set(rows.map((r) => r.Currency))];
  if (currencies.length !== 1) throw new WiseCsvError("Export one currency at a time from Wise.");

  // Oldest first: the running balance then reads in order.
  const sorted = rows.map((r) => ({ r, at: wiseDateTime(r["Date Time"] || r.Date) })).sort((a, b) => a.at.localeCompare(b.at)).map((x) => x.r);
  const lines: StatementLine[] = [];
  for (const r of sorted) {
    const amount = num(r.Amount);
    if (!amount) continue;
    const fee = num(r["Total fees"]);
    const date = wiseDate(r.Date);
    const direction = amount < 0 ? "out" : "in";
    const who = (r["Payee Name"] || r.Merchant || r["Payer Name"] || "").trim() || null;
    const kind = r["Transaction Details Type"];
    const reference = [r["Payment Reference"], r["TransferWise ID"]].filter(Boolean).join(" · ") || null;
    const description = mask([
      kind === "CARD" ? "Card" : kind === "DEPOSIT" ? "Received" : kind === "CONVERSION" || kind === "MONEY_ADDED" ? "Top-up" : "Transfer",
      who, r["Payment Reference"] || null,
    ].filter(Boolean).join(" · "));
    const balance = r["Running Balance"] ? num(r["Running Balance"]) : null;
    // An outgoing payment with a fee: the payment, then the fee. Incoming: Wise deducts nothing here.
    const paid = direction === "out" && fee > 0 ? round2(Math.abs(amount) - fee) : Math.abs(amount);
    lines.push({ date, direction, amount: paid, description, counterparty: who && mask(who), reference: reference && mask(reference), balance: direction === "out" && fee > 0 ? null : balance });
    if (direction === "out" && fee > 0) {
      lines.push({ date, direction: "out", amount: fee, description: `Wise fee · ${who ?? "transfer"}`, counterparty: "Wise", reference: r["TransferWise ID"] ? `${r["TransferWise ID"]} fee` : null, balance });
    }
  }

  const first = sorted[0], last = sorted.at(-1);
  const opening = first ? round2(num(first["Running Balance"]) - num(first.Amount)) : null;
  const closing = last ? num(last["Running Balance"]) : null;
  const sum = lines.reduce((s, l) => s + (l.direction === "in" ? l.amount : -l.amount), 0);
  const balanced = opening !== null && closing !== null ? Math.abs(round2(opening + sum) - closing) < 0.01 : null;
  const id = fileName.match(/statement_(\d+)_/)?.[1];
  return {
    bank: "Wise", currency: currencies[0], account_last4: id ? id.slice(-4) : null,
    period_start: lines[0]?.date ?? null, period_end: lines.at(-1)?.date ?? null,
    opening_balance: opening, closing_balance: closing, lines, balanced,
    notes: balanced === false ? "The running balances in the export don't add up with the amounts." : null,
  };
}

/** "27-10-2026" → "2026-10-27" (Wise also writes 2026-10-27 in some exports). */
function wiseDate(s: string): string {
  const m = s.trim().match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  throw new WiseCsvError(`Unreadable date "${s}".`);
}
function wiseDateTime(s: string): string {
  return wiseDate(s) + s.trim().slice(10);
}
const num = (s: string | undefined) => Number((s ?? "").replace(/[^\d.-]/g, "")) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;
