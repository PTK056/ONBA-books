"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { sent?: string; error?: string };

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") ?? "/overview");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid e-mail address." };

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true, // self-serve: the first link creates the account, which then goes to /setup
      emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(safeNext(next))}`,
    },
  });
  if (error) {
    console.error("[login] signInWithOtp:", error.status, error.code, error.message);
    if (error.status === 429) return { error: "Too many sign-in e-mails were sent. Wait a few minutes and try again." };
    return { error: "We couldn't send the link. Check the address and try again." };
  }
  return { sent: email };
}

function safeNext(next: string) {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/overview";
}
