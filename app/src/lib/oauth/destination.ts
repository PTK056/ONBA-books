// Where an OAuth consent sends the user's access. Any app can register itself with Supabase's OAuth server
// (dynamic client registration) and pick any name, "Splyce" or "Claude" included, so the consent page judges
// the redirect address, not the name.

/** Hosts whose callbacks we know: Claude's connectors. Splyce's own host is added by the caller. */
const KNOWN_HOSTS = ["claude.ai", "claude.com"];

export type Destination =
  | { kind: "known"; host: string }
  | { kind: "local"; host: string }   // an app on this computer (e.g. Claude Code, Claude Desktop)
  | { kind: "unknown"; host: string }
  | { kind: "invalid"; host: string };

export function classifyRedirect(redirectUri: string, appUrl: string): Destination {
  let url: URL;
  try { url = new URL(redirectUri); } catch { return { kind: "invalid", host: redirectUri }; }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return { kind: "local", host: url.host };
  if (url.protocol !== "https:") return { kind: "invalid", host: url.host || redirectUri };
  const own = new URL(appUrl).hostname.toLowerCase();
  const known = [own, ...KNOWN_HOSTS].some((h) => host === h || host.endsWith(`.${h}`));
  return { kind: known ? "known" : "unknown", host: url.host };
}
