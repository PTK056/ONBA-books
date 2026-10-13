"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CloseResult = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-\d{2}-01$/;

// Only admins may write month_closes (RLS); a closed month then refuses any change to its
// entries (database trigger) until it is reopened.
export async function setMonthClosed(villaId: string, month: string, closed: boolean): Promise<CloseResult> {
  if (!UUID.test(villaId) || !MONTH.test(month)) return { ok: false, error: "Unknown villa or month." };
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  const { data: villa } = await db.from("villas").select("organization_id").eq("id", villaId).single();
  if (!villa || !claims?.claims) return { ok: false, error: "Unknown villa." };

  const { error } = await db.from("month_closes").upsert(
    closed
      ? { organization_id: villa.organization_id, villa_id: villaId, month, status: "closed", closed_by: claims.claims.sub, closed_at: new Date().toISOString() }
      : { organization_id: villa.organization_id, villa_id: villaId, month, status: "open", closed_by: null, closed_at: null },
    { onConflict: "villa_id,month" },
  );
  if (error) return { ok: false, error: "Only an admin can close or reopen a month." };
  revalidatePath("/overview");
  return { ok: true };
}
