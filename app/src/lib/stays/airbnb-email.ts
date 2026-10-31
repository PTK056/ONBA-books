// Airbnb notification e-mails (host side): booking confirmed, payout sent, canceled, changed.
//
// Nothing is guessed. An e-mail is read only if Gmail saw a valid DKIM signature from
// airbnb.com, it is classified by the Airbnb template named in its links (c=.pi80.pk<base64>),
// not by its subject, and every expected block must be found with figures that add up.
// Anything short of that comes back as "unrecognised" and is never booked.
// Built and tested on real e-mails (docs/module-gmail-reservations.md §3).
//
// Self-contained (no app imports) so it can be tested with `node --test`.

import { header, parseMessage, type MailMessage } from "../mail/mime.ts";

export interface Confirmed {
  kind: "confirmed";
  code: string;
  guest: string;
  listingId: string | null;
  listing: string;
  checkIn: string;   // YYYY-MM-DD
  checkOut: string;
  nights: number;
  currency: string;
  gross: number;     // what the guest paid the host, after Airbnb's discounts, before its host fee
  fees: number;      // Airbnb host service fee
  net: number;       // "You earn"
}

export interface PayoutLine {
  code: string;
  guest: string;
  listingId: string;
  listing: string;
  checkIn: string;
  checkOut: string;
  amount: number;    // in the listing's currency, net of Airbnb fees
  currency: string;
}

export interface Payout {
  kind: "payout";
  /** Airbnb's Payout ID; older e-mails (before Sept 2026) have none: then date + total stand in for it. */
  payoutId: string;
  sentOn: string;
  arrivesBy: string | null;
  currency: string;  // what reached the bank, e.g. IDR
  total: number;
  lines: PayoutLine[];
}

export interface Canceled {
  kind: "canceled";
  code: string;
  /** What the host keeps under the cancellation policy, in the listing's currency. */
  kept: number;
  currency: string | null; // null when the symbol is ambiguous ($): the stay's currency applies
}

export interface Altered { kind: "altered"; code: string }
export interface SupportMessage { kind: "support_message"; codes: string[]; excerpt: string }
export interface Ignored { kind: "ignored"; reason: string }
export interface Unrecognised { kind: "unrecognised"; reason: string }

export type AirbnbEmailContent = Confirmed | Payout | Canceled | Altered | SupportMessage | Ignored | Unrecognised;

export type AirbnbEmail = AirbnbEmailContent & {
  messageId: string | null;
  subject: string;
  sentAt: string | null; // ISO
  template: string | null;
};

const CODE = /HM[A-Z0-9]{8}/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const SYMBOLS: Record<string, string> = { "€": "EUR", "£": "GBP", "Rp": "IDR", "A$": "AUD", "¥": "JPY", "₹": "INR", "฿": "THB" };

export function readAirbnbEmail(raw: string | Uint8Array): AirbnbEmail {
  const m = parseMessage(raw);
  const base = {
    messageId: header(m, "message-id"),
    subject: header(m, "subject") ?? "",
    sentAt: toIso(header(m, "date")),
    template: null as string | null,
  };
  const authentic = authenticAirbnb(m);
  if (authentic !== true) return { ...base, kind: "unrecognised", reason: authentic };
  const text = (m.text ?? "").replace(/\r\n/g, "\n");
  if (!text) return { ...base, kind: "unrecognised", reason: "No text part" };
  const template = templateOf(text);
  const out = { ...base, template };
  if (!template) return { ...out, kind: "ignored", reason: "No Airbnb template in the links" };
  return { ...out, ...readByTemplate(template, text, base.subject, base.sentAt, header(m, "from") ?? "") };
}

/** Gmail's own verdict (topmost Authentication-Results, added by mx.google.com on arrival). */
function authenticAirbnb(m: MailMessage): true | string {
  const from = header(m, "from") ?? "";
  if (!/@(?:[a-z0-9-]+\.)*airbnb\.com>?\s*$/i.test(from)) return "Not sent by airbnb.com";
  const results = m.headers.get("authentication-results")?.[0] ?? "";
  if (!/^\s*mx\.google\.com\s*;/i.test(results)) return "No Gmail authentication result";
  if (!/dkim=pass header\.i=@(?:[a-z0-9-]+\.)*airbnb\.com\b/i.test(results)) return "No valid airbnb.com signature";
  return true;
}

/** The template name Airbnb puts in every link: c=.pi80.pk<base64 of the name>. */
export function templateOf(text: string): string | null {
  const m = /[?&]c=\.pi\d+\.pk([A-Za-z0-9_\-%=]+)/.exec(text);
  if (!m) return null;
  try {
    const b64 = decodeURIComponent(m[1]).replace(/-/g, "+").replace(/_/g, "/");
    const name = new TextDecoder().decode(Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0)));
    return /^[\w/.-]+$/.test(name) ? name : null;
  } catch {
    return null;
  }
}

function readByTemplate(template: string, text: string, subject: string, sentAt: string | null, from: string): AirbnbEmailContent {
  if (template === "booking/host/ReservationHostConfirmationTemplate") return readConfirmed(text, subject, sentAt);
  if (template.startsWith("PAYMENTS_HOST_PAYOUT_SENT")) return readPayout(text, sentAt);
  if (template.startsWith("CANCELLATIONS_RESERVATION_CANCELED")) return readCanceled(text, subject);
  if (template === "ALTERATION_ACCEPTED" || template === "reservation/alteration/AlterationAcceptedTemplate") {
    const code = /reservations\/details\/(HM[A-Z0-9]{8})/.exec(text)?.[1];
    return code ? { kind: "altered", code } : { kind: "unrecognised", reason: "Change accepted, but no booking code" };
  }
  if (template.startsWith("MESSAGING_") && /@supportmessaging\.airbnb\.com/i.test(from)) {
    const body = text.split("\n").map((l) => l.trim()).filter((l) => l && !/^\[?https?:/.test(l) && l !== "%opentrack%");
    return {
      kind: "support_message",
      codes: [...new Set(text.match(new RegExp(CODE.source, "g")) ?? [])],
      excerpt: body.slice(1, 8).join(" ").slice(0, 400),
    };
  }
  if (template === "booking/reservation_host_pending") return { kind: "ignored", reason: "Reservation request, not confirmed" };
  if (template.includes("inquiry")) return { kind: "ignored", reason: "Inquiry" };
  if (template.includes("alteration_requested")) return { kind: "ignored", reason: "Change requested, not accepted" };
  if (template.startsWith("MESSAGING_")) return { kind: "ignored", reason: "Message" };
  if (/review/i.test(template)) return { kind: "ignored", reason: "Review" };
  return { kind: "ignored", reason: "Other Airbnb e-mail" };
}

// ---------------------------------------------------------------------------

function readConfirmed(text: string, subject: string, sentAt: string | null): Confirmed | Unrecognised {
  const fail = (reason: string): Unrecognised => ({ kind: "unrecognised", reason: `Booking confirmed: ${reason}` });
  const lines = text.split("\n").map((l) => l.trim());

  const codeAt = lines.findIndex((l) => l === "CONFIRMATION CODE");
  const code = codeAt >= 0 ? lines.slice(codeAt + 1).find((l) => l)?.match(new RegExp(`^${CODE.source}$`))?.[0] : undefined;
  if (!code) return fail("no confirmation code");

  const guest = /^Reservation confirmed - (.+) arrives /.exec(subject)?.[1]?.trim();
  if (!guest) return fail("no guest name in the subject");

  const roomsAt = lines.findIndex((l) => /^https:\/\/[^\s]*\/rooms\/\d+/.test(l));
  const listingId = roomsAt >= 0 ? /\/rooms\/(\d+)/.exec(lines[roomsAt])![1] : null;
  const listing = roomsAt >= 0 ? lines.slice(roomsAt + 1).find((l) => l) ?? "" : "";
  if (!listing) return fail("no listing");

  const datesAt = lines.findIndex((l) => /^Check-in\s+Checkout$/.test(l));
  const dateLine = datesAt >= 0 ? lines.slice(datesAt + 1).find((l) => l) : undefined;
  const dm = dateLine ? /^\w{3}, (\w{3}) (\d{1,2})\s{2,}\w{3}, (\w{3}) (\d{1,2})$/.exec(dateLine) : null;
  if (!dm || !sentAt) return fail("no check-in and checkout dates");
  // The e-mail gives no year: the stay starts on or after the day it was booked.
  const checkIn = nextOccurrence(dm[1], Number(dm[2]), sentAt.slice(0, 10), 2);
  const checkOut = checkIn ? nextOccurrence(dm[3], Number(dm[4]), checkIn, 0) : null;
  if (!checkIn || !checkOut || checkOut <= checkIn) return fail("unreadable dates");
  const nights = nightsBetween(checkIn, checkOut);

  const stated = /x (\d+) nights?\s/.exec(text);
  if (!stated || Number(stated[1]) !== nights) return fail("nights don't match the dates");
  const currency = /^TOTAL \(([A-Z]{3})\)/m.exec(text)?.[1];
  if (!currency) return fail("no currency");

  // Host payout block: "7 nights room fee €670.00", adjustments, "Host service fee … -€87.40", "YOU EARN €425.15".
  const payoutAt = lines.lastIndexOf("HOST PAYOUT");
  if (payoutAt < 0) return fail("no host payout");
  let gross = 0, fees = 0, net: number | null = null, roomFee = false;
  for (const line of lines.slice(payoutAt + 1)) {
    if (!line) continue;
    const m = /^(.+?)\s{2,}(-?)\D{0,3}?([\d,]+\.\d{2})$/.exec(line);
    if (!m) break;
    const amount = (m[2] ? -1 : 1) * Number(m[3].replace(/,/g, ""));
    if (/^YOU EARN$/i.test(m[1])) { net = amount; break; }
    if (/service fee/i.test(m[1])) fees += -amount;
    else { gross += amount; if (/room fee/i.test(m[1])) roomFee = true; }
  }
  if (net === null || !roomFee) return fail("host payout block incomplete");
  gross = round2(gross);
  fees = round2(fees);
  if (Math.abs(gross - fees - net) > 0.005) return fail(`host payout doesn't add up (${gross} − ${fees} ≠ ${net})`);
  if (gross < 0 || fees < 0) return fail("negative amounts");

  return { kind: "confirmed", code, guest, listingId, listing, checkIn, checkOut, nights, currency, gross, fees, net };
}

function readPayout(text: string, sentAt: string | null): Payout | Unrecognised {
  const fail = (reason: string): Unrecognised => ({ kind: "unrecognised", reason: `Payout: ${reason}` });
  const total = /^Total paid:\s+(.+?)\s+([A-Z]{3})\s*$/m.exec(text);
  if (!total) return fail("no total");
  const totalAmount = amountOf(total[1]);
  if (totalAmount === null) return fail("unreadable total");
  if (!sentAt) return fail("no date");
  const payoutId = /^Payout ID\s*\n\s*(\S+)/m.exec(text)?.[1] ?? `${sentAt.slice(0, 10)}:${total[2]}${totalAmount}`;
  const arrives = /should arrive by (\w+) (\d{1,2}), (\d{4})/.exec(text);
  const arrivesBy = arrives ? isoFromParts(arrives[3], arrives[1], arrives[2]) : null;

  const details = text.slice(text.search(/^Details\s*$/m), text.search(/^Total paid:/m));
  const lineRe = /^(.+?)\s{2,}(-?[^\d\s-]*\s?[\d,]+\.\d{2})\s+([A-Z]{3})\s*\n\s*\n?\s*\S+ • (\d{1,2}\/\d{1,2}\/\d{4}) - (\d{1,2}\/\d{1,2}\/\d{4})\s*\n\s*\n?\s*(.+) \((\d+)\)\s*\n\s*\n?\s*(HM[A-Z0-9]{8})\s*$/gm;
  const lines: PayoutLine[] = [];
  for (const l of details.matchAll(lineRe)) {
    const amount = amountOf(l[2]);
    const checkIn = usDate(l[4]), checkOut = usDate(l[5]);
    if (amount === null || !checkIn || !checkOut) return fail("unreadable line");
    lines.push({ guest: l[1].trim(), amount, currency: l[3], checkIn, checkOut, listing: l[6].trim(), listingId: l[7], code: l[8] });
  }
  if (!lines.length) return fail("no booking lines");
  // Every booking named in the details must have been read as a line.
  const codesInDetails = new Set(details.match(new RegExp(CODE.source, "g")));
  if (codesInDetails.size !== new Set(lines.map((l) => l.code)).size) return fail("some lines unreadable");
  if (new Set(lines.map((l) => l.currency)).size > 1) return fail("lines in several currencies");
  const sum = round2(lines.reduce((s, l) => s + l.amount, 0));
  if (sum <= 0) return fail("nothing paid");
  if (lines[0].currency === total[2] && Math.abs(sum - totalAmount) > 0.005) return fail("lines don't add up to the total");

  return { kind: "payout", payoutId, sentOn: sentAt.slice(0, 10), arrivesBy, currency: total[2], total: totalAmount, lines };
}

function readCanceled(text: string, subject: string): Canceled | Unrecognised {
  const code = /reservation (HM[A-Z0-9]{8})/i.exec(text)?.[1];
  if (!code || !subject.includes(code)) return { kind: "unrecognised", reason: "Canceled: no booking code" };
  const kept = /payout has been updated to\s+(\S+?)\.?\s*$/m.exec(text);
  const amount = kept ? amountOf(kept[1]) : null;
  if (amount === null) return { kind: "unrecognised", reason: "Canceled: no updated payout" };
  const symbol = kept![1].replace(/[\d.,\s-]/g, "");
  return { kind: "canceled", code, kept: amount, currency: SYMBOLS[symbol] ?? null };
}

// ---------------------------------------------------------------------------

/** "€1,147.50", "-€56.95", "Rp1,938,587.00", "€ 95.88" → number. */
function amountOf(s: string): number | null {
  const m = /^(-?)\s*[^\d\s-]{0,3}\s?(-?)([\d,]+\.\d{2})$/.exec(s.trim());
  if (!m) return null;
  return (m[1] || m[2] ? -1 : 1) * Number(m[3].replace(/,/g, ""));
}

function usDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

function isoFromParts(year: string, month: string, day: string): string | null {
  const i = MONTHS.indexOf(month.slice(0, 3).toLowerCase());
  return i < 0 ? null : `${year}-${String(i + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** First date with this month and day on or after `from` (minus a few days of slack). */
function nextOccurrence(month: string, day: number, from: string, slackDays: number): string | null {
  const year = Number(from.slice(0, 4));
  const floor = new Date(Date.parse(`${from}T00:00:00Z`) - slackDays * 86_400_000).toISOString().slice(0, 10);
  for (const y of [year, year + 1]) {
    const d = isoFromParts(String(y), month, String(day));
    if (d && d >= floor) return d;
  }
  return null;
}

function toIso(date: string | null): string | null {
  if (!date) return null;
  const t = Date.parse(date);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function nightsBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const round2 = (v: number) => Math.round(v * 100) / 100;
