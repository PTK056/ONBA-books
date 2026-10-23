import "server-only";
import { createHash } from "node:crypto";

// ONBA Books' own OAuth client for chat channels, registered once on Supabase's OAuth server
// (public client + PKCE). The user consents on /oauth/consent like any other assistant.
export const APP_URL = process.env.APP_URL ?? "https://onba-books.vercel.app";
const ISSUER = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;
export const REDIRECT_URI = `${APP_URL}/api/channels/link/callback`;
const SCOPE = "openid email offline_access";

function clientId() {
  const id = process.env.CHAT_OAUTH_CLIENT_ID;
  if (!id) throw new Error("CHAT_OAUTH_CLIENT_ID is not set");
  return id;
}

export function authorizeUrl(state: string, verifier: string) {
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const q = new URLSearchParams({
    response_type: "code", client_id: clientId(), redirect_uri: REDIRECT_URI, scope: SCOPE,
    state, code_challenge: challenge, code_challenge_method: "S256",
  });
  return `${ISSUER}/oauth/authorize?${q}`;
}

export interface Tokens { access_token: string; refresh_token: string; expires_in: number }

async function token(params: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token || !body.refresh_token) {
    throw new OAuthError(`token ${params.grant_type}: ${res.status} ${body.error ?? ""} ${body.error_description ?? ""}`, res.status);
  }
  return body as Tokens;
}

export class OAuthError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export const exchangeCode = (code: string, verifier: string) =>
  token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, code_verifier: verifier });

export const refresh = (refreshToken: string) => token({ grant_type: "refresh_token", refresh_token: refreshToken });

/** The user id in an access token we just received from the token endpoint (no need to verify our own fetch). */
export function subject(accessToken: string): string {
  const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
  if (typeof payload.sub !== "string") throw new Error("token without sub");
  return payload.sub;
}
