import { NextResponse, type NextRequest } from "next/server";
import { logDownload } from "@/lib/downloads";
import { documentFileName } from "@/lib/transactions/names";
import { createClient } from "@/lib/supabase/server";

/** GET /documents/file/<evidence id> → logs the download, then redirects to a one-minute signed link. */
export async function GET(_request: NextRequest, { params }: RouteContext<"/documents/file/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const db = await createClient();
  // RLS: only someone allowed to see this document gets a row back.
  const { data: ev } = await db.from("evidence")
    .select("organization_id, storage_path, mime_type, transaction:transactions (date, description, amount, currency)")
    .eq("id", id).maybeSingle();
  const tx = (ev as unknown as { transaction: { date: string; description: string | null; amount: number; currency: string } | null } | null)?.transaction;
  if (!ev || !tx) return new NextResponse("Not found", { status: 404 });

  const name = documentFileName({ ...tx, merchant: null, amount: Number(tx.amount) }, { path: ev.storage_path, mime: ev.mime_type });
  const { data } = await db.storage.from("evidence").createSignedUrl(ev.storage_path, 60, { download: name });
  if (!data) return new NextResponse("Not found", { status: 404 });
  await logDownload(db, ev.organization_id, "file", 1, { evidence_id: id, name, date: tx.date, amount: Number(tx.amount), currency: tx.currency });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
