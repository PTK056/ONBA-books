"use server";

import { revalidatePath } from "next/cache";
import { getCurrentOrg, places } from "@/lib/org";
import type { BankSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: true } | { ok: false; error: string };

export async function saveBankSettings(s: BankSettings): Promise<Result> {
  const org = await getCurrentOrg();
  if (org.kind !== "member" || org.role !== "admin") return { ok: false, error: "Only admins can change settings." };
  const ok = (v: string) => v === "company" || v === "villas";
  if (!ok(s.feesTo) || !ok(s.interestTo)) return { ok: false, error: "Choose who bears each one." };
  const db = await createClient();
  const { error } = await db.from("module_activations").upsert(
    { organization_id: org.id, module: "bank", enabled: true, settings: { feesTo: s.feesTo, interestTo: s.interestTo }, updated_at: new Date().toISOString() },
    { onConflict: "organization_id,module" },
  );
  if (error) return { ok: false, error: "Could not save. Try again." };
  revalidatePath("/settings");
  revalidatePath("/bank");
  return { ok: true };
}

/** The company's name as it shows next to the villas (e.g. "PT Onba Property Management"). */
export async function renameCompany(name: string): Promise<Result> {
  const org = await getCurrentOrg();
  if (org.kind !== "member" || org.role !== "admin" || !org.company) return { ok: false, error: "Only admins can change settings." };
  const clean = name.trim().slice(0, 80);
  if (!clean) return { ok: false, error: "Give it a name." };
  if (org.villas.some((v) => v.name.toLowerCase() === clean.toLowerCase())) return { ok: false, error: "A villa already has that name." };
  const db = await createClient();
  const { error } = await db.from("villas").update({ name: clean }).eq("id", org.company.id);
  if (error) return { ok: false, error: "Could not save. Try again." };
  revalidatePath("/", "layout");
  return { ok: true };
}

const CURRENCY = /^[A-Z]{3}$/;

/** A new villa: it appears in the villa chooser, the forms and the overview right away. */
export async function addVilla(name: string, currency: string): Promise<Result> {
  const org = await getCurrentOrg();
  if (org.kind !== "member" || org.role !== "admin") return { ok: false, error: "Only admins can change settings." };
  const clean = name.trim().slice(0, 80);
  const cur = currency.trim().toUpperCase();
  if (!clean) return { ok: false, error: "Name the villa." };
  if (!CURRENCY.test(cur)) return { ok: false, error: "Choose the currency the villa spends in (e.g. IDR)." };
  if (places(org).some((v) => v.name.toLowerCase() === clean.toLowerCase())) return { ok: false, error: "That name is already used." };
  const db = await createClient();
  const { error } = await db.from("villas").insert({ organization_id: org.id, name: clean, currency: cur });
  if (error) return { ok: false, error: "Could not add the villa. Try again." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function renameVilla(id: string, name: string): Promise<Result> {
  const org = await getCurrentOrg();
  if (org.kind !== "member" || org.role !== "admin") return { ok: false, error: "Only admins can change settings." };
  const clean = name.trim().slice(0, 80);
  if (!org.villas.some((v) => v.id === id)) return { ok: false, error: "Unknown villa." };
  if (!clean) return { ok: false, error: "Name the villa." };
  if (places(org).some((v) => v.id !== id && v.name.toLowerCase() === clean.toLowerCase())) return { ok: false, error: "That name is already used." };
  const db = await createClient();
  const { error } = await db.from("villas").update({ name: clean }).eq("id", id);
  if (error) return { ok: false, error: "Could not save. Try again." };
  revalidatePath("/", "layout");
  return { ok: true };
}
