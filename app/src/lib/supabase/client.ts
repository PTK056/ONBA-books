"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Supabase client in the browser, signed in through the session cookies (RLS applies). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
