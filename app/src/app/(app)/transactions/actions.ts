"use server";

import { revalidatePath } from "next/cache";
import { getCurrentOrg, places } from "@/lib/org";
import { documentFileName } from "@/lib/transactions/names";
import { createClient } from "@/lib/supabase/server";
import { logDownload } from "@/lib/downloads";

export type TxResult = { ok: true; id: string } | { ok: false; error: string };

export interface TxInput {
  direction: "in" | "out";
  date: string;
  amount: number;
  currency: string;
  fxRate: number | null;     // to the reporting currency; null = 1 or last rate used
  categoryId: string | null;
  villaId: string;
  description: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function editor() {
  const org = await getCurrentOrg();
  if (org.kind !== "member" || org.role === "owner_viewer") return null;
  return org;
}

function invalid(i: TxInput, villas: Set<string>): string | null {
  if (i.direction !== "in" && i.direction !== "out") return "Choose income or expense.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date) || isNaN(Date.parse(i.date))) return "Enter the date.";
  if (!(i.amount > 0) || !Number.isFinite(i.amount)) return "Enter the amount.";
  if (!/^[A-Z]{3}$/.test(i.currency)) return "Enter a three-letter currency code.";
  if (!villas.has(i.villaId)) return "Choose a villa.";
  if (i.categoryId !== null && !UUID.test(i.categoryId)) return "Choose a category.";
  if (i.fxRate !== null && !(i.fxRate > 0)) return "Enter the exchange rate.";
  return null;
}

/** Rate to the reporting currency: 1 if the same, else what was entered, else the last one used. */
async function rateFor(orgId: string, reporting: string, currency: string, entered: number | null) {
  if (currency === reporting) return 1;
  if (entered) return entered;
  const db = await createClient();
  const { data } = await db.from("transactions").select("fx_rate").eq("organization_id", orgId)
    .eq("currency", currency).order("date", { ascending: false }).limit(1);
  return data?.[0] ? Number(data[0].fx_rate) : null;
}

const friendly = (message: string) =>
  message.includes("closed") ? "That month is closed for this villa. Use a date in an open month." : "Could not save. Try again.";

export async function createTransaction(input: TxInput, file: { path: string; mimeType: string } | null): Promise<TxResult> {
  const org = await editor();
  if (!org) return { ok: false, error: "Only admins and staff can add entries." };
  const problem = invalid(input, new Set(places(org).map((v) => v.id)));
  if (problem) return { ok: false, error: problem };
  const fx = await rateFor(org.id, org.reportingCurrency, input.currency, input.fxRate);
  if (!fx) return { ok: false, error: `Enter the ${input.currency} → ${org.reportingCurrency} rate.` };
  if (file && !file.path.startsWith(`${org.id}/`)) return { ok: false, error: "Unknown file." };

  const db = await createClient();
  const { data, error } = await db.from("transactions").insert({
    organization_id: org.id, villa_id: input.villaId, date: input.date, direction: input.direction,
    category_id: input.categoryId, description: input.description.trim() || null,
    currency: input.currency, amount: input.amount, fx_rate: fx, status: "validated", source: "manual",
  }).select("id").single();
  if (error || !data) return { ok: false, error: friendly(error?.message ?? "") };

  if (file) {
    await db.from("evidence").insert({ organization_id: org.id, transaction_id: data.id, storage_path: file.path, mime_type: file.mimeType });
  }
  revalidatePath("/transactions");
  revalidatePath("/overview");
  return { ok: true, id: data.id };
}

/** Attaches an uploaded file to an entry. Allowed in closed months too: it documents, it doesn't change figures. */
export async function attachReceipt(transactionId: string, file: { path: string; mimeType: string }): Promise<TxResult> {
  const org = await editor();
  if (!org) return { ok: false, error: "Only admins and staff can attach receipts." };
  if (!UUID.test(transactionId) || !file.path.startsWith(`${org.id}/`)) return { ok: false, error: "Unknown entry or file." };
  const db = await createClient();
  const { error } = await db.from("evidence").insert({
    organization_id: org.id, transaction_id: transactionId, storage_path: file.path, mime_type: file.mimeType,
  });
  if (error) return { ok: false, error: "Could not attach the file. Try again." };
  revalidatePath(`/transactions/${transactionId}`);
  revalidatePath("/transactions");
  revalidatePath("/documents");
  return { ok: true, id: transactionId };
}

/** Corrects an entry made by hand or from a receipt. Imported stays are corrected by re-importing. */
export async function updateTransaction(id: string, input: TxInput): Promise<TxResult> {
  const org = await editor();
  if (!org || !UUID.test(id)) return { ok: false, error: "Only admins and staff can edit entries." };
  const problem = invalid(input, new Set(places(org).map((v) => v.id)));
  if (problem) return { ok: false, error: problem };
  const fx = await rateFor(org.id, org.reportingCurrency, input.currency, input.fxRate);
  if (!fx) return { ok: false, error: `Enter the ${input.currency} → ${org.reportingCurrency} rate.` };

  const db = await createClient();
  const { data, error } = await db.from("transactions").update({
    villa_id: input.villaId, date: input.date, direction: input.direction, category_id: input.categoryId,
    description: input.description.trim() || null, currency: input.currency, amount: input.amount, fx_rate: fx,
  }).eq("id", id).in("source", ["manual", "receipt", "module"]).select("id");
  if (error) return { ok: false, error: friendly(error.message) };
  if (!data?.length) return { ok: false, error: "This entry can't be edited here." };
  revalidatePath(`/transactions/${id}`);
  revalidatePath("/transactions");
  revalidatePath("/overview");
  return { ok: true, id };
}

export async function deleteTransaction(id: string): Promise<TxResult> {
  const org = await editor();
  if (!org || !UUID.test(id)) return { ok: false, error: "Only admins and staff can delete entries." };
  const db = await createClient();
  // Entries from a receipt stay linked to their reviewed receipt; they are corrected, not deleted.
  const { data, error } = await db.from("transactions").delete().eq("id", id).in("source", ["manual", "module"]).select("id");
  if (error) return { ok: false, error: friendly(error.message) };
  if (!data?.length) return { ok: false, error: "Only entries added by hand can be deleted; correct the others instead." };
  revalidatePath("/transactions");
  revalidatePath("/overview");
  return { ok: true, id };
}

const SHARE_LINK_DAYS = 7;

/** A download link for one document that works without signing in, for 7 days. */
export async function createShareLink(evidenceId: string): Promise<{ ok: true; url: string; days: number } | { ok: false; error: string }> {
  const org = await getCurrentOrg();
  if (org.kind !== "member" || !UUID.test(evidenceId)) return { ok: false, error: "Unknown document." };
  const db = await createClient();
  // RLS: only someone allowed to see this document gets a row back.
  const { data: ev } = await db.from("evidence")
    .select("storage_path, mime_type, transaction:transactions (date, description, amount, currency)")
    .eq("id", evidenceId).maybeSingle();
  const tx = (ev as unknown as { transaction: { date: string; description: string | null; amount: number; currency: string } | null } | null)?.transaction;
  if (!ev || !tx) return { ok: false, error: "Unknown document." };
  const name = documentFileName({ ...tx, merchant: null, amount: Number(tx.amount) }, { path: ev.storage_path, mime: ev.mime_type });
  const { data, error } = await db.storage.from("evidence")
    .createSignedUrl(ev.storage_path, SHARE_LINK_DAYS * 86_400, { download: name });
  if (error || !data) return { ok: false, error: "Could not create the link." };
  await logDownload(db, org.id, "share_link", 1, { evidence_id: evidenceId, name, valid_days: SHARE_LINK_DAYS });
  return { ok: true, url: data.signedUrl, days: SHARE_LINK_DAYS };
}
