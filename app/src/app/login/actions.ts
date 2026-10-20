"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { sent?: string; next?: string; error?: string };

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
  return { sent: email, next: safeNext(next) };
}

/** Second way in: the code from the same e-mail, typed on the device that asked for it. */
export async function verifyCode(prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = prev.sent ?? "";
  const token = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6,10}$/.test(token)) return { ...prev, error: "Enter the code from the e-mail." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) {
    console.error("[login] verifyOtp:", error.status, error.code, error.message);
    return { ...prev, error: "That code is wrong or has expired. Check the latest e-mail, or ask for a new one." };
  }
  redirect(safeNext(prev.next ?? "/overview"));
}

function safeNext(next: string) {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/overview";
}
