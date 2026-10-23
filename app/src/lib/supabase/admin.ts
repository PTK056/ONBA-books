import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Server-only client with the secret key: bypasses RLS. Used only for the chat channel tables
 * (channel_links, chat_conversations), never for the books themselves, which always go
 * through the user's own token.
 */
export function adminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
