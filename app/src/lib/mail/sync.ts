import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allocateByNights } from "@/lib/stays/airbnb";
import { readAirbnbEmail, type AirbnbEmail, type Canceled, type Confirmed } from "@/lib/stays/airbnb-email";
import { receivedShares, stayFromEmails, type PaidLine } from "@/lib/stays/email-stay";
import { autoMatch } from "@/lib/bank/ops";
import { gmailGet } from "./composio";

// Once a day per connected organization (and on "Check now"): fetch the e-mails from Airbnb,
// log each one, then rebuild the stays they are about. Runs with the server key (no user is
// signed in for the cron), always scoped to the organization that owns the connection.
// docs/module-gmail-reservations.md

const QUERY = "from:(automated@airbnb.com OR supportmessaging.airbnb.com)";
const FIRST_RUN_DAYS = 120;   // future bookings are often confirmed months ahead
const OVERLAP_DAYS = 3;       // catches a missed run
const MAX_MESSAGES = 400;
const OTHER = "Other Airbnb e-mail"; // reason given by the reader for a template it doesn't know

export interface SyncSummary { read: number; booked: number; updated: number; attention: number }

type Db = SupabaseClient;

export async function syncOrganization(db: Db, orgId: string): Promise<SyncSummary> {
  const { data: conn } = await db.from("mail_connections").select("external_id, status, last_checked_at, read_from")
    .eq("organization_id", orgId).maybeSingle();
  if (!conn || conn.status !== "active") throw new Error("Gmail is not connected");

  const startedAt = new Date();
  const since = Math.max(
    conn.last_checked_at
      ? Date.parse(conn.last_checked_at) - OVERLAP_DAYS * 86_400_000
      : startedAt.getTime() - FIRST_RUN_DAYS * 86_400_000,
    conn.read_from ? Date.parse(conn.read_from) : 0, // never before the date chosen when connecting
  );

  try {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(conn.external_id, orgId, "messages", {
        q: `${QUERY} after:${Math.floor(since / 1000)}`, maxResults: "100", ...(pageToken ? { pageToken } : {}),
      });
      ids.push(...(page.messages ?? []).map((m) => m.id));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < MAX_MESSAGES);

    // Read again what could not be read or was of an unknown kind: the readers may have learned it since.
    const { data: known } = await db.from("inbound_emails").select("external_id, result, note").eq("organization_id", orgId).in("external_id", ids);
    const seen = new Set((known ?? []).filter((k) => k.result !== "unrecognised" && k.note !== OTHER).map((k) => k.external_id));
    const fresh = ids.filter((id) => !seen.has(id)).reverse(); // oldest first: a confirmation before its payout

    const codes = new Set<string>();
    for (const id of fresh) {
      const msg = await gmailGet<{ raw: string }>(conn.external_id, orgId, `messages/${id}`, { format: "raw" });
      const email = readAirbnbEmail(Buffer.from(msg.raw, "base64url"));
      for (const code of await record(db, orgId, id, email)) codes.add(code);
    }
    const summary: SyncSummary = { read: fresh.length, booked: 0, updated: 0, attention: 0 };
    for (const code of codes) {
      const r = await applyCode(db, orgId, code);
      if (r === "booked") summary.booked++;
      else if (r === "updated") summary.updated++;
      else if (r === "needs_villa" || r === "conflict") summary.attention++;
    }
    // Bookings still waiting (e.g. for a rate) get another try: a payout read today may give it.
    const { data: waiting } = await db.from("inbound_emails").select("code")
      .eq("organization_id", orgId).eq("kind", "confirmed").eq("result", "waiting");
    for (const code of new Set((waiting ?? []).map((w) => w.code as string))) {
      if (codes.has(code)) continue;
      const r = await applyCode(db, orgId, code);
      if (r === "booked") summary.booked++;
    }
    await refreshSupportAlerts(db, orgId);
    if (codes.size) {
      // A payout read after the bank statement was added: link its line now.
      const { data: org } = await db.from("organizations").select("reporting_currency").eq("id", orgId).single();
      await autoMatch(db, orgId, org!.reporting_currency).catch((e) => console.error("[mail] bank match", orgId, e));
    }
    const { count } = await db.from("inbound_emails").select("id", { count: "exact", head: true })
      .eq("organization_id", orgId).in("result", ["unrecognised", "alert"]).gte("created_at", startedAt.toISOString());
    summary.attention += count ?? 0;

    await db.from("mail_connections").update({ last_checked_at: startedAt.toISOString(), last_error: null }).eq("organization_id", orgId);
    return summary;
  } catch (e) {
    await db.from("mail_connections").update({ last_error: e instanceof Error ? e.message : "Check failed" }).eq("organization_id", orgId);
    throw e;
  }
}

/** Logs one e-mail; returns the booking codes whose stay must be rebuilt. */
async function record(db: Db, orgId: string, externalId: string, e: AirbnbEmail): Promise<string[]> {
  const { messageId, subject, sentAt, template, ...content } = e;
  void messageId;
  const row = {
    organization_id: orgId, external_id: externalId, received_at: sentAt, subject: subject.slice(0, 300), template,
    kind: e.kind, parsed: content, code: null as string | null, listing_ref: null as string | null,
    result: "waiting", note: null as string | null,
  };

  if (e.kind === "ignored") Object.assign(row, { result: "ignored", note: e.reason });
  else if (e.kind === "unrecognised") Object.assign(row, { result: "unrecognised", note: e.reason });
  else if (e.kind === "confirmed") Object.assign(row, { code: e.code, listing_ref: e.listingId });
  else if (e.kind === "canceled" || e.kind === "altered") row.code = e.code;
  else if (e.kind === "payout") Object.assign(row, { code: e.lines[0].code, listing_ref: e.lines[0].listingId });
  else if (e.kind === "support_message") {
    // Free text written by a person: never booked. Flagged when it names a booking we know,
    // as a stay or as a confirmation still waiting (e.g. for its villa).
    const known = new Map<string, string | null>();
    if (e.codes.length) {
      const [{ data: stays }, { data: confirmations }] = await Promise.all([
        db.from("stays").select("external_ref, guest_name").eq("organization_id", orgId).eq("platform", "airbnb").in("external_ref", e.codes),
        db.from("inbound_emails").select("code, parsed").eq("organization_id", orgId).eq("kind", "confirmed").in("code", e.codes),
      ]);
      for (const c of confirmations ?? []) known.set(c.code, (c.parsed as { guest?: string }).guest ?? null);
      for (const s of stays ?? []) known.set(s.external_ref, s.guest_name);
    }
    Object.assign(row, known.size
      ? { result: "alert", code: [...known.keys()][0], note: `Airbnb Support wrote about ${[...known].map(([c, g]) => `${c}${g ? ` (${g})` : ""}`).join(", ")}: check the stay` }
      : { result: "ignored", note: "Airbnb Support message about no known booking" });
  }

  const { data: inserted, error } = await db.from("inbound_emails").upsert(row, { onConflict: "organization_id,external_id" }).select("id").single();
  if (error) throw new Error("Could not log an e-mail");
  if (e.kind === "payout") {
    const shares = receivedShares(e.lines, e.total);
    await db.from("stay_payouts").upsert(e.lines.map((l, i) => ({
      organization_id: orgId, platform: "airbnb", code: l.code, payout_ref: e.payoutId, sent_on: e.sentOn, arrives_by: e.arrivesBy,
      check_in: l.checkIn, check_out: l.checkOut, amount: l.amount, currency: l.currency,
      received: shares[i], received_currency: e.currency, email_id: inserted.id,
    })), { onConflict: "organization_id,platform,payout_ref,code", ignoreDuplicates: true });
    return [...new Set(e.lines.map((l) => l.code))];
  }
  return row.code && row.result === "waiting" ? [row.code] : [];
}

/** A support message read before the booking it names was known (or its stay created) gets its alert now. */
async function refreshSupportAlerts(db: Db, orgId: string) {
  const { data: messages } = await db.from("inbound_emails").select("id, parsed")
    .eq("organization_id", orgId).eq("kind", "support_message").eq("result", "ignored");
  for (const m of messages ?? []) {
    const codes = (m.parsed as { codes?: string[] }).codes ?? [];
    if (!codes.length) continue;
    const { data: confirmations } = await db.from("inbound_emails").select("code, parsed")
      .eq("organization_id", orgId).eq("kind", "confirmed").in("code", codes);
    if (!confirmations?.length) continue;
    const named = confirmations.map((c) => `${c.code}${(c.parsed as { guest?: string }).guest ? ` (${(c.parsed as { guest: string }).guest})` : ""}`);
    await db.from("inbound_emails").update({ result: "alert", code: confirmations[0].code, note: `Airbnb Support wrote about ${[...new Set(named)].join(", ")}: check the stay` })
      .eq("id", m.id);
  }
}

type Result = "booked" | "updated" | "unchanged" | "needs_villa" | "conflict" | "waiting";

/** Rebuilds one booking from all its e-mails and saves it; marks its e-mails with the outcome. */
export async function applyCode(db: Db, orgId: string, code: string): Promise<Result> {
  const { data: emails } = await db.from("inbound_emails").select("id, kind, parsed, listing_ref, received_at")
    .eq("organization_id", orgId).eq("code", code).in("kind", ["confirmed", "canceled", "altered", "payout"])
    .order("received_at", { ascending: false });
  const latest = <K extends string>(kind: K) => emails?.find((m) => m.kind === kind);
  const confirmed = latest("confirmed")?.parsed as Confirmed | undefined;
  const canceled = latest("canceled")?.parsed as Canceled | undefined;
  const listingRef = confirmed?.listingId ?? emails?.find((m) => m.listing_ref)?.listing_ref ?? null;

  const { data: existing } = await db.from("stays").select("id, villa_id, source, status")
    .eq("organization_id", orgId).eq("platform", "airbnb").eq("external_ref", code).maybeSingle();
  const { data: mapped } = listingRef
    ? await db.from("listing_villas").select("villa_id").eq("organization_id", orgId).eq("platform", "airbnb").eq("listing_ref", listingRef).maybeSingle()
    : { data: null };
  const villaId: string | null = existing?.villa_id ?? mapped?.villa_id ?? null;

  const mark = async (result: Result, note: string | null, stayId: string | null = existing?.id ?? null) => {
    await db.from("inbound_emails").update({ result, note, stay_id: stayId })
      .eq("organization_id", orgId).eq("code", code).in("kind", ["confirmed", "canceled", "altered", "payout"]);
    return result;
  };

  if (!confirmed) {
    // Payout or cancellation of a booking confirmed before Gmail was connected.
    if (!existing) return mark("waiting", "Booking not in Splyce yet: the Airbnb export will bring it");
    if (!canceled || existing.status === "canceled") return mark("unchanged", "Stay from the Airbnb export, which stays the reference");
    return save(db, villaId!, [{ code, source: "email", status: "canceled", lines: [] }], mark, "Marked canceled");
  }
  if (!villaId) return mark("needs_villa", `Choose the villa for ${confirmed.listing}`);

  const { data: payoutRows } = await db.from("stay_payouts")
    .select("amount, currency, received, received_currency, check_in, check_out, sent_on")
    .eq("organization_id", orgId).eq("platform", "airbnb").eq("code", code);
  const payouts: PaidLine[] = (payoutRows ?? []).map((p) => ({
    amount: Number(p.amount), currency: p.currency, received: Number(p.received), receivedCurrency: p.received_currency,
    checkIn: p.check_in, checkOut: p.check_out, sentOn: p.sent_on,
  }));
  const built = stayFromEmails(confirmed, payouts, canceled ?? null);

  const { data: org } = await db.from("organizations").select("reporting_currency").eq("id", orgId).single();
  const reporting = org!.reporting_currency as string;
  let rate: number | undefined = built.stay.currency === reporting ? 1 : built.stay.payoutRates[reporting];
  const estimatedRate = rate === undefined;
  if (rate === undefined) {
    const { data: last } = await db.from("transactions").select("fx_rate").eq("organization_id", orgId)
      .eq("currency", built.stay.currency).order("date", { ascending: false }).limit(1).maybeSingle();
    rate = last?.fx_rate ? Number(last.fx_rate) : undefined;
  }
  if (rate === undefined) {
    // Books kept in the reporting currency only (e.g. migrated): the rate of the latest payout read.
    const { data: payout } = await db.from("stay_payouts").select("amount, received").eq("organization_id", orgId)
      .eq("currency", built.stay.currency).eq("received_currency", reporting).gt("amount", 0)
      .order("sent_on", { ascending: false }).limit(1).maybeSingle();
    rate = payout ? Number(payout.received) / Number(payout.amount) : undefined;
  }
  if (!rate) return mark("waiting", `No ${built.stay.currency} → ${reporting} rate yet: waiting for the payout`);

  const notes = [
    built.status === "canceled" ? "Canceled" : built.paid ? "Paid" : "Booked, not paid yet",
    estimatedRate ? "rate estimated until the payout" : null,
    built.feesEstimated ? "fees estimated until the Airbnb export" : null,
  ].filter(Boolean).join("; ");
  const s = built.stay;
  return save(db, villaId, [{
    code, guest: s.guest, check_in: s.checkIn, check_out: s.checkOut, currency: s.currency, gross: s.gross, fees: s.fees,
    payout_date: s.payoutDate, source: "email", status: built.status, lines: allocateByNights(s, rate),
  }], mark, notes);
}

async function save(
  db: Db, villaId: string, stays: Record<string, unknown>[],
  mark: (r: Result, note: string | null, stayId?: string | null) => Promise<Result>, note: string,
): Promise<Result> {
  const { data, error } = await db.rpc("import_stays", { p_villa: villaId, p_platform: "airbnb", p_stays: stays });
  if (error) throw new Error("Could not save a stay");
  const r = data as { created: number; updated: number; conflicts: { reason: string }[] };
  const code = stays[0].code as string;
  const { data: stay } = await db.from("stays").select("id").eq("villa_id", villaId).eq("platform", "airbnb").eq("external_ref", code).maybeSingle();
  if (r.conflicts.length) return mark("conflict", r.conflicts[0].reason.includes("closed") ? "Touches a closed month" : r.conflicts[0].reason, stay?.id ?? null);
  return mark(r.created ? "booked" : r.updated ? "updated" : "unchanged", note, stay?.id ?? null);
}
