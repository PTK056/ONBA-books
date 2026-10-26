import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DownloadKind = "zip" | "share_link" | "file";

/**
 * Notes that the signed-in user took documents out of the app. Written with their own session,
 * so the row carries their id; only admins can read the log. A failure never blocks the download.
 */
export async function logDownload(db: SupabaseClient, organizationId: string, kind: DownloadKind, files: number, details: object) {
  const { data } = await db.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  const { error } = await db.from("download_log").insert({ organization_id: organizationId, user_email: email, kind, files, details });
  if (error) console.error("[download_log]", error.message);
}
