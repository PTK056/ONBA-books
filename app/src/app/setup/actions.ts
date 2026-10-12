"use server";

import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export type SetupState = { error?: string };

const CURRENCY = /^[A-Z]{3}$/;

/** Creates the organization (caller becomes admin) if needed, then its first villa. */
export async function setUp(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const orgName = String(formData.get("orgName") ?? "").trim();
  const reporting = String(formData.get("reportingCurrency") ?? "").trim().toUpperCase();
  const villaName = String(formData.get("villaName") ?? "").trim();
  const villaCurrency = String(formData.get("villaCurrency") ?? "").trim().toUpperCase();

  const current = await getCurrentOrg();
  if (current.kind === "signed_out") redirect("/login?next=/setup");
  if (current.kind === "member" && current.villas.length) redirect("/upload");

  if (!villaName) return { error: "Name your villa." };
  if (!CURRENCY.test(villaCurrency)) return { error: "Choose the currency the villa spends in." };

  const db = await createClient();
  let orgId: string;
  if (current.kind === "member") {
    if (current.role !== "admin") return { error: "Ask an admin of your organization to add a villa." };
    orgId = current.id;
  } else {
    if (!orgName) return { error: "Name your organization." };
    if (!CURRENCY.test(reporting)) return { error: "Choose the currency for your reports." };
    const { data, error } = await db.rpc("create_organization", { org_name: orgName, reporting_currency: reporting });
    if (error || !data) return { error: "Could not create the organization. Try again." };
    orgId = data as string;
  }

  const { error } = await db.from("villas").insert({ organization_id: orgId, name: villaName, currency: villaCurrency });
  if (error) return { error: "The organization exists but the villa could not be saved. Try again." };
  redirect("/upload");
}
