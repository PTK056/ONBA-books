import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Proposed, ReviewItem, ReviewOptions } from "./types";

const SIGNED_URL_TTL = 60 * 60; // seconds

export type ReviewQueueData =
  | { kind: "signed_out" }
  | { kind: "no_organization" }
  | { kind: "ready"; items: ReviewItem[]; options: ReviewOptions };

/** Read receipts waiting for review in the user's organization (admin or staff). */
export async function loadReviewQueue(orgId?: string): Promise<ReviewQueueData> {
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims) return { kind: "signed_out" };

  let membership = db.from("memberships")
    .select("organization_id, organizations (name, reporting_currency)")
    .eq("user_id", claims.claims.sub).in("role", ["admin", "staff"]);
  if (orgId) membership = membership.eq("organization_id", orgId);
  const { data: memberships } = await membership.limit(1);
  const m = memberships?.[0] as unknown as
    | { organization_id: string; organizations: { name: string; reporting_currency: string } }
    | undefined;
  if (!m) return { kind: "no_organization" };
  const org = m.organization_id;

  const [items, categories, villas, rates] = await Promise.all([
    db.from("receipt_items")
      .select("id, proposed, evidence:evidence_id (storage_path, mime_type)")
      .eq("organization_id", org).eq("status", "pending").not("read_at", "is", null)
      .order("read_at", { ascending: true }),
    db.from("categories").select("id, name").eq("organization_id", org)
      .eq("kind", "expense").is("archived_at", null).order("name"),
    db.from("villas").select("id, name, currency").eq("organization_id", org)
      .is("archived_at", null).order("name"),
    db.from("transactions").select("currency, fx_rate").eq("organization_id", org)
      .order("date", { ascending: false }).limit(200),
  ]);

  type Row = { id: string; proposed: Proposed; evidence: { storage_path: string; mime_type: string } };
  const rows = (items.data ?? []) as unknown as Row[];
  const { data: signed } = rows.length
    ? await db.storage.from("evidence").createSignedUrls(rows.map((r) => r.evidence.storage_path), SIGNED_URL_TTL)
    : { data: [] };
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  const lastRates: Record<string, number> = {};
  for (const r of rates.data ?? []) lastRates[r.currency] ??= Number(r.fx_rate);

  return {
    kind: "ready",
    items: rows.map((r) => ({
      id: r.id,
      fileUrl: urlByPath.get(r.evidence.storage_path) ?? null,
      mimeType: r.evidence.mime_type,
      proposed: r.proposed,
    })),
    options: {
      organizationName: m.organizations.name,
      reportingCurrency: m.organizations.reporting_currency,
      categories: categories.data ?? [],
      villas: villas.data ?? [],
      lastRates,
    },
  };
}
