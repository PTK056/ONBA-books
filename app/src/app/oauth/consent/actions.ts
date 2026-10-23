"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ConsentState = { error?: string };

/** Records the user's answer and sends the browser back to the assistant with a code (or access_denied). */
export async function decide(_prev: ConsentState, formData: FormData): Promise<ConsentState> {
  const id = String(formData.get("authorization_id") ?? "");
  const approve = formData.get("decision") === "approve";
  const supabase = await createClient();
  const { data, error } = approve
    ? await supabase.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
  if (error || !data?.redirect_url) {
    console.error("[oauth] consent:", error?.status, error?.code, error?.message);
    return { error: "This request has expired. Start the connection again from your assistant." };
  }
  redirect(data.redirect_url);
}
