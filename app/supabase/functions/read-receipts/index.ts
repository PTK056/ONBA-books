// Edge Function: read every unread item of a receipt batch with Claude.
//
// POST { "batch_id": "<uuid>" } with the user's Authorization header.
// Runs with the caller's rights (RLS applies), so only an admin or staff member of the
// batch's organization can trigger it. Items are processed up to MAX_ITEMS per call;
// calling again resumes with the items still unread. Responds once the call's items are read.

import Anthropic from "npm:@anthropic-ai/sdk@^0.131.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@^2.100.0";
import { extractReceipt, UnsupportedFileError } from "./extract.ts";

const MAX_ITEMS = 20;
const CONCURRENCY = 4;

const anthropic = new Anthropic(); // ANTHROPIC_API_KEY from the function's secrets

// The web app calls this function from the browser, which first sends a CORS preflight.
// Access is still decided by the caller's JWT and RLS, not by the origin.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Not signed in" }, 401);

  const { batch_id } = await req.json().catch(() => ({}));
  if (typeof batch_id !== "string") return json({ error: "batch_id required" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });

  const { data: batch, error: batchErr } = await db
    .from("receipt_batches").select("id, organization_id, villa_id, status").eq("id", batch_id).maybeSingle();
  if (batchErr) return json({ error: batchErr.message }, 500);
  if (!batch) return json({ error: "Batch not found" }, 404);

  const ctx = await loadContext(db, batch.organization_id);

  const { data: items, error: itemsErr } = await db
    .from("receipt_items")
    .select("id, evidence (id, storage_path, mime_type)")
    .eq("batch_id", batch_id)
    .eq("status", "pending")
    .is("read_at", null)
    .limit(MAX_ITEMS);
  if (itemsErr) return json({ error: itemsErr.message }, 500);

  // Many-to-one embed: PostgREST returns an object; without generated types it is typed as an array.
  let unread = (items ?? []) as unknown as Item[];

  // Each receipt read spends one unit of the organization's monthly quota; the rest stay unread.
  const { data: granted, error: quotaErr } = unread.length
    ? await db.rpc("ai_take", { org: batch.organization_id, k: "receipt", wanted: unread.length })
    : { data: 0, error: null };
  if (quotaErr) return json({ error: quotaErr.message }, 500);
  const quotaReached = (granted as number) < unread.length;
  unread = unread.slice(0, granted as number);

  await db.from("receipt_batches").update({ status: "processing" }).eq("id", batch_id);

  const results = await mapLimit(unread, CONCURRENCY, (item) => readItem(db, item, ctx, batch.villa_id));

  const { count: remaining } = await db
    .from("receipt_items").select("id", { count: "exact", head: true })
    .eq("batch_id", batch_id).is("read_at", null);

  if (!remaining) {
    await db.from("receipt_batches").update({ status: "to_review" }).eq("id", batch_id);
  }

  return json({
    read: results.filter((r) => r === "ok").length,
    failed: results.filter((r) => r !== "ok").length,
    remaining: remaining ?? 0,
    quota_reached: quotaReached,
  });
});

type Item = { id: string; evidence: { id: string; storage_path: string; mime_type: string } };

type Context = Awaited<ReturnType<typeof loadContext>>;

async function readItem(db: SupabaseClient, item: Item, ctx: Context, batchVilla: string | null) {
  let proposed: Record<string, unknown>;
  try {
    const { data: blob, error } = await db.storage.from("evidence").download(item.evidence.storage_path);
    if (error || !blob) throw new Error(`Could not download file: ${error?.message ?? "empty"}`);
    const base64 = toBase64(new Uint8Array(await blob.arrayBuffer()));

    const extracted = await extractReceipt(anthropic, { mimeType: item.evidence.mime_type, base64 }, ctx);

    await db.from("evidence")
      .update({ extracted, confidence: extracted.confidence })
      .eq("id", item.evidence.id);

    proposed = {
      ...extracted,
      villa_id: ctx.villaIds[extracted.villa ?? ""] ?? batchVilla,
      category_id: ctx.categoryIds[extracted.category ?? ""] ?? null,
      possible_duplicate_of: await findDuplicate(db, ctx.organizationId, extracted),
    };
  } catch (err) {
    const unsupported = err instanceof UnsupportedFileError;
    if (!unsupported && err instanceof Anthropic.APIError && (err.status === 429 || (err.status ?? 0) >= 500)) {
      // Transient: leave the item unread so the next call retries it.
      console.error(`item ${item.id}: ${err.message}`);
      return "retry";
    }
    proposed = { error: err instanceof Error ? err.message : String(err) };
  }
  await db.from("receipt_items").update({ proposed, read_at: new Date().toISOString() }).eq("id", item.id);
  return "error" in proposed ? "error" : "ok";
}

async function loadContext(db: SupabaseClient, orgId: string) {
  const [{ data: cats }, { data: villas }, history] = await Promise.all([
    db.from("categories").select("id, name").eq("organization_id", orgId)
      .eq("kind", "expense").is("archived_at", null),
    db.from("villas").select("id, name, currency").eq("organization_id", orgId).is("archived_at", null),
    loadHistory(db, orgId),
  ]);
  const currencies = (villas ?? []).map((v) => v.currency);
  const defaultCurrency = mostCommon(currencies) ?? "USD";
  return {
    organizationId: orgId,
    categories: (cats ?? []).map((c) => c.name),
    villas: (villas ?? []).map((v) => v.name),
    defaultCurrency,
    history,
    categoryIds: Object.fromEntries((cats ?? []).map((c) => [c.name, c.id])),
    villaIds: Object.fromEntries((villas ?? []).map((v) => [v.name, v.id])),
  };
}

const HISTORY_SIZE = 40;

/** Recent reviewed receipts as "merchant: description → category", one line per distinct label. */
async function loadHistory(db: SupabaseClient, orgId: string) {
  const { data } = await db.from("transactions")
    .select("description, category:categories (name), evidence (extracted)")
    .eq("organization_id", orgId).eq("source", "receipt").eq("status", "validated")
    .not("category_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(HISTORY_SIZE * 5);
  type Row = { description: string | null; category: { name: string } | null; evidence: { extracted: { merchant?: string } | null }[] };
  const seen = new Set<string>();
  const out: { label: string; category: string }[] = [];
  for (const row of (data ?? []) as unknown as Row[]) {
    const merchant = row.evidence?.[0]?.extracted?.merchant;
    const label = [merchant, row.description].filter(Boolean).join(": ");
    if (!label || !row.category || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, category: row.category.name });
    if (out.length === HISTORY_SIZE) break;
  }
  return out;
}

/** Same date, currency and amount already in the books: likely the same receipt twice. */
async function findDuplicate(
  db: SupabaseClient,
  orgId: string,
  e: { date: string | null; currency: string | null; total: number | null },
): Promise<string | null> {
  if (!e.date || !e.currency || !e.total) return null;
  const { data } = await db.from("transactions").select("id")
    .eq("organization_id", orgId).eq("date", e.date).eq("currency", e.currency).eq("amount", e.total).limit(1);
  return data?.[0]?.id ?? null;
}

async function mapLimit<T, R>(xs: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, xs.length) }, async () => {
    while (next < xs.length) {
      const i = next++;
      out[i] = await fn(xs[i]);
    }
  }));
  return out;
}

function mostCommon(xs: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
