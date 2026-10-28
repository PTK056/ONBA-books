import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type CurrentOrg =
  | { kind: "signed_out" }
  | { kind: "none" }
  | {
      kind: "member";
      id: string;
      name: string;
      role: "admin" | "staff" | "owner_viewer";
      reportingCurrency: string;
      /** The places to stay; the company is apart (see migration company). */
      villas: { id: string; name: string; currency: string }[];
      /** Where what belongs to no villa is booked: bank fees, accountant… Null only for owners, who never see it. */
      company: { id: string; name: string; currency: string } | null;
    };

/** Where an entry can be booked: the villas, then the company. */
export function places(org: Extract<CurrentOrg, { kind: "member" }>) {
  return org.company ? [...org.villas, org.company] : org.villas;
}

/** The signed-in user's first organization where they can enter data, with its villas. */
export async function getCurrentOrg(): Promise<CurrentOrg> {
  await connection(); // per-request data: never prerender (the Supabase client reads the clock)
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims) return { kind: "signed_out" };

  const { data } = await db.from("memberships")
    .select("role, organization_id, organizations (name, reporting_currency)")
    .eq("user_id", claims.claims.sub)
    .order("created_at")
    .limit(1);
  const m = data?.[0] as unknown as
    | { role: "admin" | "staff" | "owner_viewer"; organization_id: string; organizations: { name: string; reporting_currency: string } }
    | undefined;
  if (!m) return { kind: "none" };

  const { data: places } = await db.from("villas").select("id, name, currency, kind")
    .eq("organization_id", m.organization_id).is("archived_at", null).order("name");
  const strip = (v: { id: string; name: string; currency: string }) => ({ id: v.id, name: v.name, currency: v.currency });
  return {
    kind: "member",
    id: m.organization_id,
    name: m.organizations.name,
    role: m.role,
    reportingCurrency: m.organizations.reporting_currency,
    villas: (places ?? []).filter((v) => v.kind === "villa").map(strip),
    company: (places ?? []).filter((v) => v.kind === "company").map(strip)[0] ?? null,
  };
}

/** Cookie holding the villa (or the company) chosen in the sidebar; absent = all of them. */
export const PLACE_COOKIE = "splyce_place";

type Member = Extract<CurrentOrg, { kind: "member" }>;

/** The villa or company chosen in the sidebar, if it still exists in this organization. */
export async function selectedPlace(org: Member) {
  const id = (await cookies()).get(PLACE_COOKIE)?.value;
  return places(org).find((p) => p.id === id) ?? null;
}

/**
 * The organization as the sidebar's choice shows it: only the chosen villa (or only the company).
 * `scope` lists the ids to filter entries on, null when everything is shown.
 */
export async function scopedOrg(org: Member): Promise<{ org: Member; scope: string[] | null }> {
  const place = await selectedPlace(org);
  if (!place) return { org, scope: null };
  const isCompany = place.id === org.company?.id;
  return { org: { ...org, villas: isCompany ? [] : [place], company: isCompany ? place : null }, scope: [place.id] };
}
