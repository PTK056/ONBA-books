"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { APP_URL } from "@/lib/app-url";
import { ComposioError, createGmailLink, deleteAccount } from "@/lib/mail/composio";
import { applyCode, syncOrganization } from "@/lib/mail/sync";
import { getCurrentOrg } from "@/lib/org";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: true; message?: string } | { ok: false; error: string };

async function admin() {
  const org = await getCurrentOrg();
  return org.kind === "member" && org.role === "admin" ? org : null;
}

/**
 * Sends the admin to Google (through Composio) to allow Splyce to read the mailbox.
 * `readFrom` (YYYY-MM-DD): nothing older is ever read, e.g. the day the books were last brought up to date.
 */
export async function connectGmail(readFrom: string): Promise<Result> {
  const org = await admin();
  if (!org) return { ok: false, error: "Only admins can connect Gmail." };
  const earliest = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(readFrom) || readFrom < earliest || readFrom > new Date().toISOString().slice(0, 10)) {
    return { ok: false, error: "Choose a start date within the last 12 months." };
  }
  let link: { redirectUrl: string; accountId: string };
  try {
    link = await createGmailLink(org.id, `${APP_URL}/api/connections/gmail/callback`);
  } catch (e) {
    console.error("[gmail connect]", e);
    return { ok: false, error: e instanceof ComposioError && e.message.includes("not set") ? "Gmail isn't set up on this server yet." : "Could not reach Gmail. Try again." };
  }
  const db = await createClient();
  const { error } = await db.from("mail_connections").upsert(
    { organization_id: org.id, external_id: link.accountId, status: "pending", last_error: null, last_checked_at: null, read_from: `${readFrom}T00:00:00Z` },
    { onConflict: "organization_id" },
  );
  if (error) return { ok: false, error: "Could not start. Try again." };
  redirect(link.redirectUrl);
}

export async function disconnectGmail(): Promise<Result> {
  const org = await admin();
  if (!org) return { ok: false, error: "Only admins can disconnect Gmail." };
  const db = await createClient();
  const { data: conn } = await db.from("mail_connections").select("external_id").eq("organization_id", org.id).maybeSingle();
  if (conn) {
    try {
      await deleteAccount(conn.external_id);
    } catch (e) {
      console.error("[gmail disconnect]", e); // removed here anyway; Google access can also be revoked from the Google account
    }
    await db.from("mail_connections").delete().eq("organization_id", org.id);
  }
  revalidatePath("/connections");
  return { ok: true };
}

/** "Check now": the daily check, for this organization, right away. */
export async function checkNow(): Promise<Result> {
  const org = await admin();
  if (!org) return { ok: false, error: "Only admins can check e-mails." };
  try {
    const r = await syncOrganization(adminClient(), org.id);
    revalidatePath("/connections");
    revalidatePath("/overview");
    const parts = [`${r.read} new e-mail${r.read === 1 ? "" : "s"}`];
    if (r.booked) parts.push(`${r.booked} stay${r.booked === 1 ? "" : "s"} added`);
    if (r.updated) parts.push(`${r.updated} updated`);
    if (r.attention) parts.push(`${r.attention} to look at`);
    return { ok: true, message: parts.join(", ") + "." };
  } catch (e) {
    console.error("[gmail check]", e);
    revalidatePath("/connections");
    return { ok: false, error: "The check failed. Try again in a moment." };
  }
}

/** Which villa a listing is; then the bookings waiting for it are saved. */
export async function chooseVilla(listingRef: string, listingName: string, villaId: string): Promise<Result> {
  const org = await admin();
  if (!org) return { ok: false, error: "Only admins can do this." };
  if (!org.villas.some((v) => v.id === villaId)) return { ok: false, error: "Choose one of your villas." };
  const db = await createClient();
  const { error } = await db.from("listing_villas").upsert(
    { organization_id: org.id, platform: "airbnb", listing_ref: listingRef, listing_name: listingName.slice(0, 200), villa_id: villaId },
    { onConflict: "organization_id,platform,listing_ref" },
  );
  if (error) return { ok: false, error: "Could not save. Try again." };
  const { data: waiting } = await db.from("inbound_emails").select("code")
    .eq("organization_id", org.id).eq("listing_ref", listingRef).eq("result", "needs_villa");
  const svc = adminClient();
  for (const code of new Set((waiting ?? []).map((w) => w.code as string))) await applyCode(svc, org.id, code);
  revalidatePath("/connections");
  revalidatePath("/overview");
  return { ok: true };
}

/**
 * Answer to an alert (a support message naming a booking): "cancel" books the stay as canceled with
 * nothing kept, as when Airbnb cancels without consequences; "keep" leaves it as it is.
 */
export async function answerAlert(emailId: string, answer: "cancel" | "keep"): Promise<Result> {
  const org = await admin();
  if (!org) return { ok: false, error: "Only admins can do this." };
  const db = await createClient();
  const { data: alert } = await db.from("inbound_emails").select("id, code")
    .eq("organization_id", org.id).eq("id", emailId).eq("result", "alert").maybeSingle();
  if (!alert?.code) return { ok: false, error: "This alert was already answered." };
  if (answer === "keep") {
    await db.from("inbound_emails").update({ result: "ignored", note: "Stay kept" }).eq("id", alert.id);
  } else {
    const { error } = await db.from("inbound_emails").upsert({
      organization_id: org.id, external_id: `manual-cancel:${alert.code}`, received_at: new Date().toISOString(),
      subject: "Canceled from Connections", kind: "canceled", code: alert.code, result: "waiting",
      parsed: { kind: "canceled", code: alert.code, kept: 0, currency: null },
    }, { onConflict: "organization_id,external_id" });
    if (error) return { ok: false, error: "Could not cancel. Try again." };
    const r = await applyCode(adminClient(), org.id, alert.code);
    if (r === "conflict") return { ok: false, error: "The stay touches a closed month: reopen it first." };
    await db.from("inbound_emails").update({ result: "updated", note: "Stay canceled" }).eq("id", alert.id);
  }
  revalidatePath("/connections");
  revalidatePath("/overview");
  return { ok: true };
}
