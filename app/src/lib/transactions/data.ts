import "server-only";
import { connection } from "next/server";
import { getCurrentOrg, type CurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { documentFileName } from "./names";

const MAX_ROWS = 3000;        // a villa books a few hundred lines a year
const SIGNED_URL_TTL = 60 * 60;

export interface TxFile { id: string; path: string; mime: string }

export interface Tx {
  id: string;
  date: string;
  direction: "in" | "out";
  source: "manual" | "receipt" | "stay" | "adjustment" | "module";
  description: string | null;
  merchant: string | null;
  category: { id: string; name: string } | null;
  villa: { id: string; name: string };
  amount: number;
  currency: string;
  fxRate: number;
  amountReporting: number;
  stayCode: string | null;
  files: TxFile[];
}

export interface TxFilters {
  q?: string;
  month?: string;          // YYYY-MM
  villa?: string;
  category?: string;
  direction?: "in" | "out";
  receipt?: "missing" | "attached";
  source?: string;
}

type Member = Extract<CurrentOrg, { kind: "member" }>;

type Row = {
  id: string; date: string; direction: "in" | "out"; source: Tx["source"]; description: string | null;
  amount: number; currency: string; fx_rate: number; amount_reporting: number; villa_id: string;
  category: { id: string; name: string } | null;
  stay: { external_ref: string | null } | null;
  evidence: { id: string; storage_path: string; mime_type: string; extracted: { merchant?: string | null } | null }[];
};

const SELECT = "id, date, direction, source, description, amount, currency, fx_rate, amount_reporting, villa_id, category:categories (id, name), stay:stays (external_ref), evidence (id, storage_path, mime_type, extracted)";

function toTx(r: Row, villaNames: Map<string, string>): Tx {
  return {
    id: r.id,
    date: r.date,
    direction: r.direction,
    source: r.source,
    description: r.description,
    merchant: r.evidence?.find((e) => e.extracted?.merchant)?.extracted?.merchant ?? null,
    category: r.category,
    villa: { id: r.villa_id, name: villaNames.get(r.villa_id) ?? "" },
    amount: Number(r.amount),
    currency: r.currency,
    fxRate: Number(r.fx_rate),
    amountReporting: Number(r.amount_reporting),
    stayCode: r.stay?.external_ref ?? null,
    files: (r.evidence ?? []).map((e) => ({ id: e.id, path: e.storage_path, mime: e.mime_type })),
  };
}

/** Receipts are expected on expenses entered by hand or from a receipt, not on imported stays. */
export const needsReceipt = (t: Pick<Tx, "direction" | "source">) =>
  t.direction === "out" && (t.source === "manual" || t.source === "receipt");

export async function listTransactions(f: TxFilters): Promise<
  | { kind: "signed_out" } | { kind: "no_organization" }
  | { kind: "ready"; org: Member; rows: Tx[]; truncated: boolean; categories: { id: string; name: string; kind: string }[] }
> {
  await connection();
  const org = await getCurrentOrg();
  if (org.kind === "signed_out") return { kind: "signed_out" };
  if (org.kind === "none") return { kind: "no_organization" };
  const db = await createClient();

  let query = db.from("transactions").select(SELECT)
    .eq("organization_id", org.id).eq("status", "validated")
    .order("date", { ascending: false }).order("created_at", { ascending: false }).limit(MAX_ROWS);
  if (f.month && /^\d{4}-\d{2}$/.test(f.month)) {
    const start = `${f.month}-01`;
    const end = new Date(Date.UTC(+f.month.slice(0, 4), +f.month.slice(5, 7), 1)).toISOString().slice(0, 10);
    query = query.gte("date", start).lt("date", end);
  }
  if (f.villa) query = query.eq("villa_id", f.villa);
  if (f.category) query = query.eq("category_id", f.category);
  if (f.direction) query = query.eq("direction", f.direction);
  if (f.source) query = query.eq("source", f.source);

  const [{ data }, { data: categories }] = await Promise.all([
    query,
    db.from("categories").select("id, name, kind").eq("organization_id", org.id).is("archived_at", null).order("name"),
  ]);
  const villaNames = new Map(org.villas.map((v) => [v.id, v.name]));
  let rows = ((data ?? []) as unknown as Row[]).map((r) => toTx(r, villaNames));

  if (f.receipt === "missing") rows = rows.filter((t) => needsReceipt(t) && !t.files.length);
  if (f.receipt === "attached") rows = rows.filter((t) => t.files.length > 0);
  const q = f.q?.trim().toLowerCase();
  if (q) {
    rows = rows.filter((t) =>
      [t.description, t.merchant, t.category?.name, t.villa.name, t.stayCode, String(t.amount)]
        .some((v) => v?.toLowerCase().includes(q)));
  }
  return { kind: "ready", org, rows, truncated: (data?.length ?? 0) >= MAX_ROWS, categories: categories ?? [] };
}

export interface TxFileLinks extends TxFile { name: string; viewUrl: string | null; downloadUrl: string | null }

export async function getTransaction(id: string): Promise<{ org: Member; tx: Tx; files: TxFileLinks[]; closed: boolean; categories: { id: string; name: string; kind: string }[] } | null> {
  await connection();
  const org = await getCurrentOrg();
  if (org.kind !== "member") return null;
  const db = await createClient();
  const { data } = await db.from("transactions").select(SELECT).eq("id", id).eq("organization_id", org.id).maybeSingle();
  if (!data) return null;
  const tx = toTx(data as unknown as Row, new Map(org.villas.map((v) => [v.id, v.name])));

  const [files, close, categories] = await Promise.all([
    signFiles(tx),
    db.from("month_closes").select("status").eq("villa_id", tx.villa.id).eq("month", `${tx.date.slice(0, 7)}-01`).maybeSingle(),
    db.from("categories").select("id, name, kind").eq("organization_id", org.id).is("archived_at", null).order("name"),
  ]);
  return { org, tx, files, closed: close.data?.status === "closed", categories: categories.data ?? [] };
}

/** View and download links for a transaction's files; download links carry a readable file name. */
export async function signFiles(tx: Tx): Promise<TxFileLinks[]> {
  const db = await createClient();
  return Promise.all(tx.files.map(async (f, i) => {
    const name = documentFileName(tx, f, tx.files.length > 1 ? i + 1 : undefined);
    const [view, download] = await Promise.all([
      db.storage.from("evidence").createSignedUrl(f.path, SIGNED_URL_TTL),
      db.storage.from("evidence").createSignedUrl(f.path, SIGNED_URL_TTL, { download: name }),
    ]);
    return { ...f, name, viewUrl: view.data?.signedUrl ?? null, downloadUrl: download.data?.signedUrl ?? null };
  }));
}
