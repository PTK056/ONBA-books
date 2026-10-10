"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { sent?: string; error?: string };

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") ?? "/review");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid e-mail address." };

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false, // accounts are created by invitation, not from the login page
      emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(safeNext(next))}`,
    },
  });
  if (error) return { error: "We couldn't send the link. Check the address or ask your admin for an invitation." };
  return { sent: email };
}

function safeNext(next: string) {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/review";
}
