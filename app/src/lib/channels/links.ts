import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt, randomToken, sha256 } from "./crypto";
import { OAuthError, refresh, subject, type Tokens } from "./oauth";

export type ChannelName = "telegram" | "whatsapp";
const CODE_MINUTES = 15;

export interface Link { id: string; user_id: string; external_id: string | null }

/** After the OAuth consent: stores the user's tokens and returns a one-time code their own chat must send back. */
export async function createPendingLink(channel: ChannelName, tokens: Tokens): Promise<string> {
  const code = randomToken(18); // 24 url-safe chars: fits Telegram's /start parameter
  const userId = subject(tokens.access_token);
  const db = adminClient();
  // Codes this user never redeemed hold a refresh token for nothing: drop them.
  await db.from("channel_links").delete().eq("user_id", userId).is("external_id", null);
  const { error } = await db.from("channel_links").insert({
    user_id: userId, channel,
    link_code_hash: sha256(code), link_code_expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
    refresh_token_enc: encrypt(tokens.refresh_token), access_token_enc: encrypt(tokens.access_token),
    access_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  });
  if (error) throw new Error(`createPendingLink: ${error.message}`);
  return code;
}

/** /start CODE from a chat: binds that chat to the account that created the code. One chat = one account. */
export async function redeemCode(channel: ChannelName, code: string, externalId: string, externalName: string | null) {
  const db = adminClient();
  const { data: link } = await db.from("channel_links").select("id, user_id")
    .eq("channel", channel).eq("link_code_hash", sha256(code)).gt("link_code_expires_at", new Date().toISOString())
    .is("external_id", null).maybeSingle();
  if (!link) return null;
  await db.from("channel_links").delete().eq("channel", channel).eq("external_id", externalId); // replaces an older link of this chat
  const { error } = await db.from("channel_links").update({
    external_id: externalId, external_name: externalName, linked_at: new Date().toISOString(),
    link_code_hash: null, link_code_expires_at: null,
  }).eq("id", link.id);
  if (error) throw new Error(`redeemCode: ${error.message}`);
  const { data: user } = await db.auth.admin.getUserById(link.user_id);
  return { linkId: link.id as string, userId: link.user_id as string, email: user?.user?.email ?? null };
}

export async function findLink(channel: ChannelName, externalId: string): Promise<Link | null> {
  const { data } = await adminClient().from("channel_links").select("id, user_id, external_id")
    .eq("channel", channel).eq("external_id", externalId).maybeSingle();
  return data as Link | null;
}

export async function unlink(channel: ChannelName, externalId: string) {
  await adminClient().from("channel_links").delete().eq("channel", channel).eq("external_id", externalId);
}

/** A valid access token for the linked user, refreshed (and the rotated refresh token saved) when needed. */
export async function accessTokenFor(linkId: string): Promise<string | null> {
  const db = adminClient();
  const { data: l } = await db.from("channel_links")
    .select("refresh_token_enc, access_token_enc, access_expires_at").eq("id", linkId).single();
  if (!l) return null;
  if (l.access_token_enc && l.access_expires_at && Date.parse(l.access_expires_at) > Date.now() + 120_000) {
    return decrypt(l.access_token_enc);
  }
  try {
    const t = await refresh(decrypt(l.refresh_token_enc));
    await db.from("channel_links").update({
      refresh_token_enc: encrypt(t.refresh_token), access_token_enc: encrypt(t.access_token),
      access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), last_used_at: new Date().toISOString(),
    }).eq("id", linkId);
    return t.access_token;
  } catch (e) {
    if (e instanceof OAuthError && e.status >= 400 && e.status < 500) return null; // revoked or expired: relink
    throw e;
  }
}
