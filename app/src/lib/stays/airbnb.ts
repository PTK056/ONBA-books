// Airbnb "Transaction history" CSV (Earnings → Transaction history → Download CSV).
//
// The file lists each payout followed by the lines it pays. Booking lines are in the
// listing's currency (e.g. EUR) and the payout in the bank's (e.g. IDR), so each payout
// gives the exact rate that was applied. A booking can appear on several lines: long stays
// paid in instalments, alterations, refunds to the guest ("Resolution Adjustment") or
// corrections ("Adjustment"). Lines are grouped by confirmation code into one stay.
//
// Self-contained (no app imports) so it can be tested with `node --test`.

export interface AirbnbStay {
  code: string;
  listing: string;
  guest: string | null;
  checkIn: string;   // YYYY-MM-DD
  checkOut: string;  // YYYY-MM-DD
  nights: number;
  currency: string;  // currency of the booking lines
  gross: number;     // what the guest paid the host, before Airbnb's host fee
  fees: number;      // Airbnb host service fee
  net: number;       // gross - fees, what Airbnb pays out
  payoutDate: string | null;
  /** Rates to payout currencies seen for this booking, e.g. { IDR: 20404.1 }. */
  payoutRates: Record<string, number>;
}

export interface ParseResult {
  stays: AirbnbStay[];
  listings: string[];
  warnings: string[];
}

const REQUIRED = ["Date", "Type", "Confirmation Code", "Start date", "End date", "Nights", "Currency", "Amount", "Paid out", "Service fee", "Gross earnings"];

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF. */
export function readCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

/** Airbnb writes MM/DD/YYYY. */
function isoDate(us: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(us);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

const num = (v: string) => (v === "" ? null : Number(v.replace(/,/g, "")));
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

export function parseAirbnbCsv(text: string): ParseResult {
  const rows = readCsv(text);
  const warnings: string[] = [];
  const missing = REQUIRED.filter((c) => !(rows[0] && c in rows[0]));
  if (!rows.length || missing.length) {
    return { stays: [], listings: [], warnings: [
      missing.length
        ? `This doesn't look like an Airbnb transaction history: missing ${missing.join(", ")}.`
        : "The file is empty.",
    ] };
  }

  // Each payout is followed by the lines it pays; give every line its payout.
  type Line = { row: Record<string, string>; payout: { date: string | null; currency: string; amount: number } | null };
  const lines: Line[] = [];
  let payout: Line["payout"] = null;
  for (const row of rows) {
    if (row.Type === "Payout") {
      payout = { date: isoDate(row.Date), currency: row.Currency, amount: num(row["Paid out"]) ?? 0 };
    } else if (row["Confirmation Code"]) {
      lines.push({ row, payout });
    } else {
      warnings.push(`Skipped a "${row.Type}" line dated ${row.Date} with no confirmation code.`);
    }
  }

  // Rate per payout: payout amount / sum of the lines it pays (in the booking currency).
  const payoutRate = new Map<Line["payout"], number>();
  for (const p of new Set(lines.map((l) => l.payout))) {
    if (!p) continue;
    const own = lines.filter((l) => l.payout === p);
    const sum = own.reduce((s, l) => s + (num(l.row.Amount) ?? 0), 0);
    const currencies = new Set(own.map((l) => l.row.Currency));
    if (sum > 0 && currencies.size === 1 && !currencies.has(p.currency)) payoutRate.set(p, p.amount / sum);
    if (currencies.size === 1 && currencies.has(p.currency)) payoutRate.set(p, 1);
  }

  const byCode = new Map<string, Line[]>();
  for (const l of lines) byCode.set(l.row["Confirmation Code"], [...(byCode.get(l.row["Confirmation Code"]) ?? []), l]);

  const stays: AirbnbStay[] = [];
  for (const [code, own] of byCode) {
    const reservation = own.find((l) => l.row.Type === "Reservation") ?? own[0];
    const r = reservation.row;
    const checkIn = isoDate(r["Start date"]);
    const checkOut = isoDate(r["End date"]);
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      warnings.push(`${code}: unreadable dates, skipped.`);
      continue;
    }
    const currencies = new Set(own.map((l) => l.row.Currency));
    if (currencies.size > 1) {
      warnings.push(`${code}: lines in several currencies, skipped.`);
      continue;
    }

    let gross = 0;
    let fees = 0;
    for (const { row } of own) {
      const amount = num(row.Amount) ?? 0;
      const fee = num(row["Service fee"]) ?? 0;
      const g = num(row["Gross earnings"]);
      if (g !== null) {
        gross += g;
        fees += g - amount; // keeps net = gross - fees exact, whatever the fee column's rounding
      } else {
        // Adjustments carry no gross: Airbnb refunds its fee on the amount taken back,
        // so the gross moves by the amount plus that fee, in the same direction.
        const signedFee = amount < 0 ? -Math.abs(fee) : Math.abs(fee);
        gross += amount + signedFee;
        fees += signedFee;
      }
    }

    const payoutRates: Record<string, number> = {};
    for (const l of own) {
      const rate = l.payout && payoutRate.get(l.payout);
      if (l.payout && rate) payoutRates[l.payout.currency] ??= rate;
    }
    if (own.some((l) => /resolution/i.test(l.row.Type)) && gross - fees < 0.05 * gross) {
      warnings.push(`${code}: refunded to the guest; only what Airbnb kept is booked.`);
    }
    const payoutDates = own.map((l) => l.payout?.date).filter((d): d is string => Boolean(d)).sort();

    stays.push({
      code,
      listing: r.Listing,
      guest: r.Guest || null,
      checkIn,
      checkOut,
      nights: Number(r.Nights) || nightsBetween(checkIn, checkOut),
      currency: r.Currency,
      gross: round(gross, 2),
      fees: round(fees, 2),
      net: round(gross - fees, 2),
      payoutDate: payoutDates.at(-1) ?? null,
      payoutRates,
    });
  }

  stays.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  return { stays, listings: [...new Set(stays.map((s) => s.listing))], warnings };
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
}

export interface StayLine {
  date: string;
  direction: "in" | "out";
  category: "Accommodation" | "Platform fees";
  amount: number;
  currency: string;
  fx_rate: number;
  description: string;
}

/**
 * Splits a stay's gross income and fees across months by nights (a night belongs to the
 * month it starts in). Each month's line is dated on the first night in that month.
 * The last month takes the rounding remainder so the lines add up exactly.
 */
export function allocateByNights(stay: AirbnbStay, fxRate: number, platform = "Airbnb"): StayLine[] {
  const months = new Map<string, { first: string; nights: number }>();
  for (let d = Date.parse(`${stay.checkIn}T00:00:00Z`); d < Date.parse(`${stay.checkOut}T00:00:00Z`); d += 86_400_000) {
    const day = new Date(d).toISOString().slice(0, 10);
    const key = day.slice(0, 7);
    const m = months.get(key);
    if (m) m.nights++; else months.set(key, { first: day, nights: 1 });
  }
  const total = [...months.values()].reduce((s, m) => s + m.nights, 0);
  const parts = [...months.values()];
  const split = (amount: number) => {
    let left = round(amount, 2);
    return parts.map((m, i) => {
      const share = i === parts.length - 1 ? left : round((amount * m.nights) / total, 2);
      left = round(left - share, 2);
      return share;
    });
  };

  const gross = split(stay.gross);
  const fees = split(stay.fees);
  const lines: StayLine[] = [];
  parts.forEach((m, i) => {
    const label = `${platform} ${stay.code} · ${m.nights} of ${total} night${total === 1 ? "" : "s"}`;
    const base = { date: m.first, currency: stay.currency, fx_rate: round(fxRate, 10) };
    if (gross[i] > 0) lines.push({ ...base, direction: "in", category: "Accommodation", amount: gross[i], description: label });
    if (fees[i] > 0) lines.push({ ...base, direction: "out", category: "Platform fees", amount: fees[i], description: `${label} · host fee` });
  });
  return lines;
}
