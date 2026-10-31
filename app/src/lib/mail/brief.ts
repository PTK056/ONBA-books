import "server-only";
import { APP_URL } from "@/lib/app-url";
import { payoutsPage } from "@/lib/bank/data";
import type { Session } from "@/lib/mcp/session";

// The morning brief's Airbnb lines (docs/module-gmail-reservations.md §8). Never what the Airbnb app already
// shows (new bookings, cancellations, payouts sent): only the books and the bank. Admins only.

/** Payouts read since about the last brief (the Gmail check runs 1h30 before it, "Check now" any time). */
const SINCE_HOURS = 26;
/** No successful Gmail check for this long: something is wrong. */
const STALE_HOURS = 36;

export interface AirbnbBrief {
  /** Stays whose payout was read: now in the books at the real rate. Once per stay. */
  in_books: { guest: string | null; check_in: string; check_out: string; net: number; currency: string; net_listing: number; listing_currency: string }[];
  /** Sent by Airbnb, past its arrival date, and not on the bank statements that cover that date. */
  late_payouts: { guest: string | null; amount: number; currency: string; due_by: string | null }[];
  gmail_problem: string | null;
  bank_link: string | null;
  connections_link: string | null;
}

export async function airbnbBrief(s: Session): Promise<AirbnbBrief | null> {
  if (s.role !== "admin") return null;
  const { data: conn } = await s.db.from("mail_connections").select("status, last_checked_at, last_error")
    .eq("organization_id", s.org.id).maybeSingle();
  if (!conn) return null;

  const stale = !conn.last_checked_at || Date.now() - Date.parse(conn.last_checked_at) > STALE_HOURS * 3_600_000;
  const gmailProblem = conn.status !== "active" ? "Gmail needs reconnecting"
    : conn.last_error ? `The last Gmail check failed (${conn.last_error})`
    : stale ? "No Gmail check for more than a day" : null;

  // Stays a payout was read for since the last brief.
  const since = new Date(Date.now() - SINCE_HOURS * 3_600_000).toISOString();
  const { data: fresh } = await s.db.from("stay_payouts").select("code").eq("organization_id", s.org.id).gte("created_at", since);
  const codes = [...new Set((fresh ?? []).map((p) => p.code))];
  const inBooks: AirbnbBrief["in_books"] = [];
  if (codes.length) {
    const [{ data: stays }, { data: payouts }] = await Promise.all([
      s.db.from("stays").select("external_ref, guest_name, check_in, check_out, currency, net_amount, status")
        .eq("organization_id", s.org.id).eq("platform", "airbnb").in("external_ref", codes),
      s.db.from("stay_payouts").select("code, received, received_currency").eq("organization_id", s.org.id).in("code", codes),
    ]);
    for (const x of stays ?? []) {
      if (x.status !== "confirmed") continue;
      const own = (payouts ?? []).filter((p) => p.code === x.external_ref && p.received_currency === s.org.reportingCurrency);
      if (!own.length) continue;
      inBooks.push({
        guest: x.guest_name, check_in: x.check_in, check_out: x.check_out,
        net: own.reduce((t, p) => t + Number(p.received), 0), currency: s.org.reportingCurrency,
        net_listing: Number(x.net_amount), listing_currency: x.currency,
      });
    }
  }

  const { data: last } = await s.db.from("bank_lines").select("date").eq("organization_id", s.org.id)
    .order("date", { ascending: false }).limit(1).maybeSingle();
  const { expected } = await payoutsPage(s.db, s.org.id, last?.date ?? null);
  const late = expected.filter((p) => p.state === "late")
    .map((p) => ({ guest: p.guest, amount: p.received, currency: p.currency, due_by: p.arrivesBy }));

  if (!inBooks.length && !late.length && !gmailProblem) return null;
  return {
    in_books: inBooks,
    late_payouts: late,
    gmail_problem: gmailProblem,
    bank_link: late.length ? `${APP_URL}/bank` : null,
    connections_link: gmailProblem ? `${APP_URL}/connections` : null,
  };
}
