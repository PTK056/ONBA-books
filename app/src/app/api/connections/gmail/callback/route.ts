import { after, NextResponse, type NextRequest } from "next/server";
import { APP_URL } from "@/lib/app-url";
import { accountStatus, gmailGet } from "@/lib/mail/composio";
import { syncOrganization } from "@/lib/mail/sync";
import { getCurrentOrg } from "@/lib/org";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

// Back from Google (through Composio). The query string is not proof of anything: the account
// must be the one this organization started connecting, and Composio must say it is active.
export async function GET(request: NextRequest) {
  const back = (state: string) => NextResponse.redirect(new URL(`/connections?gmail=${state}`, APP_URL));
  const org = await getCurrentOrg();
  if (org.kind !== "member" || org.role !== "admin") return back("failed");

  const db = await createClient();
  const { data: conn } = await db.from("mail_connections").select("external_id").eq("organization_id", org.id).maybeSingle();
  const returned = request.nextUrl.searchParams.get("connected_account_id");
  if (!conn || (returned && returned !== conn.external_id)) return back("failed");

  let status: string;
  try {
    status = await accountStatus(conn.external_id);
  } catch {
    return back("failed");
  }
  if (status !== "ACTIVE") {
    await db.from("mail_connections").update({ status: "error", last_error: `Gmail access ${status.toLowerCase()}` }).eq("organization_id", org.id);
    return back(request.nextUrl.searchParams.get("status") === "failed" ? "denied" : "failed");
  }

  const profile = await gmailGet<{ emailAddress?: string }>(conn.external_id, org.id, "profile").catch(() => null);
  await db.from("mail_connections").update({ status: "active", account_label: profile?.emailAddress ?? null, last_error: null })
    .eq("organization_id", org.id);

  // First check (the last 120 days) once the page is back: it can take a minute.
  const orgId = org.id;
  after(() => syncOrganization(adminClient(), orgId).catch((e) => console.error("[gmail first check]", orgId, e)));
  return back("connected");
}
