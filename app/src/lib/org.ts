import "server-only";
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
      villas: { id: string; name: string; currency: string }[];
    };

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

  const { data: villas } = await db.from("villas").select("id, name, currency")
    .eq("organization_id", m.organization_id).is("archived_at", null).order("name");
  return {
    kind: "member",
    id: m.organization_id,
    name: m.organizations.name,
    role: m.role,
    reportingCurrency: m.organizations.reporting_currency,
    villas: villas ?? [],
  };
}
