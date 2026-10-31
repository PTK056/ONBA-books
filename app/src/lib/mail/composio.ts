import "server-only";

// Composio (pilot): Gmail connected through Composio's own Google app, already verified by
// Google. Splyce keeps only the connected account id; Google's tokens stay at Composio and
// every Gmail call goes through their proxy. REST API v3.1, docs.composio.dev.
// Env: COMPOSIO_API_KEY, COMPOSIO_GMAIL_AUTH_CONFIG_ID (the Gmail auth config, Composio managed).

const BASE = "https://backend.composio.dev/api/v3.1";

export class ComposioError extends Error {}

function apiKey() {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new ComposioError("COMPOSIO_API_KEY is not set");
  return key;
}

async function call<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method,
    headers: { "x-api-key": apiKey(), ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new ComposioError(`Composio ${init.method} ${path.split("?")[0]}: ${res.status}`);
  return (await res.json()) as T;
}

/** Link the user opens to grant Gmail access. `userId` is the organization: one mailbox per organization. */
export async function createGmailLink(userId: string, callbackUrl: string) {
  const authConfig = process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID;
  if (!authConfig) throw new ComposioError("COMPOSIO_GMAIL_AUTH_CONFIG_ID is not set");
  const r = await call<{ redirect_url: string; connected_account_id: string }>("/connected_accounts/link", {
    method: "POST",
    body: { auth_config_id: authConfig, user_id: userId, callback_url: callbackUrl },
  });
  return { redirectUrl: r.redirect_url, accountId: r.connected_account_id };
}

export async function accountStatus(accountId: string): Promise<string> {
  const r = await call<{ status: string }>(`/connected_accounts/${encodeURIComponent(accountId)}`, { method: "GET" });
  return r.status;
}

/**
 * Removes the connection at Composio; with `revoke`, also withdraws Google's access, which Google
 * applies to every connection of that mailbox through Composio's app, not just this one.
 */
export async function deleteAccount(accountId: string, revoke: boolean) {
  await call(`/connected_accounts/${encodeURIComponent(accountId)}${revoke ? "?revoke_on_delete=true" : ""}`, { method: "DELETE" });
}

/** A Gmail API GET through Composio's proxy (Composio adds the Google credentials). */
export async function gmailGet<T>(accountId: string, userId: string, path: string, query: Record<string, string> = {}): Promise<T> {
  const r = await call<{ status: number; data: T }>("/tools/execute/proxy", {
    method: "POST",
    body: {
      connected_account_id: accountId,
      user_id: userId,
      endpoint: `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
      method: "GET",
      parameters: Object.entries(query).map(([name, value]) => ({ name, value, type: "query" })),
    },
  });
  if (r.status < 200 || r.status >= 300) throw new ComposioError(`Gmail ${path.split("/")[0]}: ${r.status}`);
  return r.data;
}
