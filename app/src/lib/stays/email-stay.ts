// One stay from everything the e-mails said about its booking code: the confirmation
// (amounts in the listing's currency), the payouts (what reached the bank, hence the real rate,
// and new dates after a change) and a cancellation (what the host keeps).
//
// Self-contained (no app imports) so it can be tested with `node --test`.

import type { AirbnbStay } from "./airbnb.ts";
import type { Canceled, Confirmed } from "./airbnb-email.ts";

export interface PaidLine {
  amount: number;            // booking currency, net of fees
  currency: string;
  received: number;          // this line's share of what reached the bank
  receivedCurrency: string;
  checkIn: string;
  checkOut: string;
  sentOn: string;
}

export interface EmailStay {
  stay: AirbnbStay;
  status: "confirmed" | "canceled";
  paid: boolean;            // payouts cover what the host earns
  /** Fees worked out rather than read (extra nights, cancellation): the export will give the real ones. */
  feesEstimated: boolean;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function stayFromEmails(confirmed: Confirmed, payouts: PaidLine[], canceled: Canceled | null): EmailStay {
  const own = payouts.filter((p) => p.currency === confirmed.currency);
  const paidNet = round2(own.reduce((s, p) => s + p.amount, 0));
  // Airbnb's fee as a share of the gross, used for amounts the e-mails give net only.
  const feeShare = confirmed.gross > 0 ? confirmed.fees / confirmed.gross : 0;
  const grossFor = (net: number) => round2(net / (1 - feeShare));

  let gross = confirmed.gross, fees = confirmed.fees, feesEstimated = false;
  let checkOut = confirmed.checkOut;
  for (const p of own) if (p.checkOut > checkOut && p.checkIn === confirmed.checkIn) checkOut = p.checkOut;

  if (canceled) {
    // What the host keeps; once paid out, the payouts are the exact figure.
    const net = own.length ? paidNet : canceled.kept;
    gross = net > 0 ? grossFor(net) : 0;
    fees = round2(gross - net);
    feesEstimated = net > 0;
  } else if (paidNet > confirmed.net + 0.01) {
    // Paid more than booked: nights added after the booking. The payout gives the extra, net.
    gross = round2(confirmed.gross + grossFor(paidNet - confirmed.net));
    fees = round2(gross - paidNet);
    feesEstimated = true;
  }

  const payoutRates: Record<string, number> = {};
  for (const cur of new Set(own.map((p) => p.receivedCurrency))) {
    const lines = own.filter((p) => p.receivedCurrency === cur);
    const amount = lines.reduce((s, p) => s + p.amount, 0);
    const received = lines.reduce((s, p) => s + p.received, 0);
    if (amount > 0 && received > 0) payoutRates[cur] = cur === confirmed.currency ? 1 : received / amount;
  }
  const net = round2(gross - fees);

  return {
    stay: {
      code: confirmed.code,
      listing: confirmed.listing,
      guest: confirmed.guest,
      checkIn: confirmed.checkIn,
      checkOut,
      nights: Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${confirmed.checkIn}T00:00:00Z`)) / 86_400_000),
      currency: confirmed.currency,
      gross,
      fees,
      net,
      payoutDate: own.map((p) => p.sentOn).sort().at(-1) ?? null,
      payoutRates,
    },
    status: canceled ? "canceled" : "confirmed",
    paid: own.length > 0 && paidNet >= net - 0.01,
    feesEstimated,
  };
}

/** Each line's share of a payout's total, in the bank's currency (exact when one line). */
export function receivedShares(lines: { amount: number }[], total: number): number[] {
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  if (!sum) return lines.map(() => 0);
  let left = total;
  return lines.map((l, i) => {
    const share = i === lines.length - 1 ? left : round2((total * l.amount) / sum);
    left = round2(left - share);
    return share;
  });
}
