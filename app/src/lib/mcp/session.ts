import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { APP_URL } from "@/lib/app-url";

/** Supabase client acting as the user the bearer token was issued to (RLS applies, as in the app). */
export function clientFor(token: string): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** withMcpAuth hook: accepts a Supabase access token (from the OAuth flow) for this project. */
export async function verifyToken(_req: Request, token?: string): Promise<AuthInfo | undefined> {
  if (!token) return undefined;
  const { data, error } = await clientFor(token).auth.getClaims(token);
  const c = data?.claims;
  if (error || !c?.sub || c.role !== "authenticated") return undefined;
  return {
    token,
    clientId: typeof c.client_id === "string" ? c.client_id : "",
    scopes: typeof c.scope === "string" ? c.scope.split(" ").filter(Boolean) : [],
    expiresAt: typeof c.exp === "number" ? c.exp : undefined,
    extra: { userId: c.sub },
  };
}

export interface Villa { id: string; name: string; currency: string }
export interface Category { id: string; name: string; kind: "income" | "expense" }

export interface Session {
  db: SupabaseClient;
  token: string;
  userId: string;
  org: { id: string; name: string; reportingCurrency: string; timezone: string; evidenceThreshold: number };
  role: "admin" | "staff" | "owner_viewer";
  villas: Villa[];
  categories: Category[];
  /** Chat agent only: files the user sent, already stored in the evidence bucket. */
  attachments?: Map<string, { path: string; mimeType: string }>;
  usedAttachments?: Set<string>;
}

export class ToolError extends Error {}

/** Spends units of the organization's monthly AI quota (see migration ai_quotas); returns how many were granted. */
export async function takeQuota(s: Session, kind: "receipt" | "agent_message" | "voice_minute", wanted = 1): Promise<number> {
  const { data, error } = await s.db.rpc("ai_take", { org: s.org.id, k: kind, wanted });
  if (error) throw new Error(`ai_take: ${error.message}`);
  return data as number;
}

/** The user's first organization (as in the app), with its villas and categories. */
export async function loadSession(auth: AuthInfo | undefined): Promise<Session> {
  const userId = auth?.extra?.userId;
  if (!auth || typeof userId !== "string") throw new ToolError("Not signed in. Reconnect Splyce in your assistant.");
  return sessionFor(auth.token, userId);
}

/** Session for a user whose access token we already hold (MCP call or chat channel). */
export async function sessionFor(token: string, userId: string): Promise<Session> {
  const db = clientFor(token);

  const { data: m } = await db.from("memberships")
    .select("role, organization_id, organizations (name, reporting_currency, timezone, evidence_threshold)")
    .eq("user_id", userId).order("created_at").limit(1).maybeSingle();
  const row = m as unknown as {
    role: Session["role"]; organization_id: string;
    organizations: { name: string; reporting_currency: string; timezone: string; evidence_threshold: number };
  } | null;
  if (!row) throw new ToolError(`This account has no organization yet. Finish setup at ${APP_URL}/setup.`);

  const [villas, categories] = await Promise.all([
    db.from("villas").select("id, name, currency").eq("organization_id", row.organization_id).is("archived_at", null).order("name"),
    db.from("categories").select("id, name, kind").eq("organization_id", row.organization_id).is("archived_at", null).order("name"),
  ]);
  return {
    db, token, userId,
    org: {
      id: row.organization_id, name: row.organizations.name, reportingCurrency: row.organizations.reporting_currency,
      timezone: row.organizations.timezone, evidenceThreshold: Number(row.organizations.evidence_threshold),
    },
    role: row.role,
    villas: (villas.data ?? []) as Villa[],
    categories: (categories.data ?? []) as Category[],
  };
}

export function requireEditor(s: Session) {
  if (s.role === "owner_viewer") throw new ToolError("This account can only read. Ask an admin of the organization for staff access.");
}

/** Today in the organization's time zone, YYYY-MM-DD. */
export function today(s: Session): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: s.org.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const norm = (x: string) => x.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Villa by id or by name (case and accents ignored, partial match if unique); the only villa if none given. */
export function resolveVilla(s: Session, wanted?: string | null): Villa {
  const names = s.villas.map((v) => v.name).join(", ");
  if (!s.villas.length) throw new ToolError("This organization has no villa yet.");
  if (!wanted) {
    if (s.villas.length === 1) return s.villas[0];
    throw new ToolError(`Which villa? One of: ${names}.`);
  }
  const w = norm(wanted);
  const exact = s.villas.filter((v) => v.id === wanted || norm(v.name) === w);
  if (exact.length === 1) return exact[0];
  const partial = s.villas.filter((v) => norm(v.name).includes(w) || w.includes(norm(v.name)));
  if (partial.length === 1) return partial[0];
  throw new ToolError(`Unknown villa "${wanted}". Use one of: ${names}.`);
}

/** Category by id or name within a kind; null if none given. */
export function resolveCategory(s: Session, kind: Category["kind"], wanted?: string | null): Category | null {
  if (!wanted) return null;
  const list = s.categories.filter((c) => c.kind === kind);
  const w = norm(wanted);
  const hit = list.filter((c) => c.id === wanted || norm(c.name) === w);
  if (hit.length === 1) return hit[0];
  const partial = list.filter((c) => norm(c.name).includes(w));
  if (partial.length === 1) return partial[0];
  throw new ToolError(`Unknown ${kind} category "${wanted}". Use one of: ${list.map((c) => c.name).join(", ")}.`);
}

/** Rate from `currency` to the reporting currency: 1 if the same, else the one given, else the last one used. */
export async function rateFor(s: Session, currency: string, given?: number | null): Promise<number> {
  if (currency === s.org.reportingCurrency) return 1;
  if (given) return given;
  const { data } = await s.db.from("transactions").select("fx_rate").eq("organization_id", s.org.id)
    .eq("currency", currency).order("date", { ascending: false }).limit(1);
  if (data?.[0]) return Number(data[0].fx_rate);
  throw new ToolError(`No ${currency} → ${s.org.reportingCurrency} rate on file yet. Give fx_rate (1 ${currency} = ? ${s.org.reportingCurrency}).`);
}
