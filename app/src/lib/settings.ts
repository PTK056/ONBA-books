import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Organization settings: what differs from one client or one contract to another is a setting, never a code change.
// Stored per module in module_activations.settings; anything missing takes the default below.

/** Who bears bank fees, and who gets bank interest: the company, or the villas in equal shares. */
export type Bearer = "company" | "villas";
export interface BankSettings { feesTo: Bearer; interestTo: Bearer }
export const BANK_DEFAULTS: BankSettings = { feesTo: "company", interestTo: "company" };

export async function bankSettings(db: SupabaseClient, orgId: string): Promise<BankSettings> {
  const { data } = await db.from("module_activations").select("settings").eq("organization_id", orgId).eq("module", "bank").maybeSingle();
  const s = (data?.settings ?? {}) as Partial<BankSettings>;
  const bearer = (v: unknown, d: Bearer): Bearer => (v === "company" || v === "villas" ? v : d);
  return { feesTo: bearer(s.feesTo, BANK_DEFAULTS.feesTo), interestTo: bearer(s.interestTo, BANK_DEFAULTS.interestTo) };
}
