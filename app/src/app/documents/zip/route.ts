import { zipSync } from "fflate";
import { type NextRequest } from "next/server";
import { listTransactions } from "@/lib/transactions/data";
import { documentFileName } from "@/lib/transactions/names";
import { createClient } from "@/lib/supabase/server";
import { logDownload } from "@/lib/downloads";

const MAX_FILES = 400;

/**
 * GET /documents/zip?month=YYYY-MM and/or ?category=<id> [&villa=…] → the matching documents
 * (a month, a category all time, or both), plus an index.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const month = sp.get("month")?.match(/^\d{4}-(0[1-9]|1[0-2])$/)?.[0];
  const category = sp.get("category")?.match(/^[0-9a-f-]{36}$/i)?.[0];
  const villa = sp.get("villa") ?? undefined;
  if (!month && !category) return new Response("Choose a month or a category", { status: 400 });

  const result = await listTransactions({ month, category, villa, receipt: "attached" });
  if (result.kind !== "ready") return new Response("Not signed in", { status: 401 });
  const files = result.rows.flatMap((tx) => tx.files.map((f, i) => ({ tx, f, i: tx.files.length > 1 ? i + 1 : undefined })));
  if (!files.length) return new Response("No documents for this month", { status: 404 });
  if (files.length > MAX_FILES) return new Response("Too many documents; narrow to a month or a villa", { status: 413 });

  const db = await createClient();
  const entries: Record<string, Uint8Array> = {};
  const index = [["date", "description", "supplier", "category", "villa", "amount", "currency", "file"]];
  const used = new Set<string>();
  for (const { tx, f, i } of files) {
    const { data } = await db.storage.from("evidence").download(f.path);
    if (!data) continue;
    let name = documentFileName(tx, f, i);
    for (let n = 2; used.has(name); n++) name = name.replace(/(\.\w+)$/, `_${n}$1`);
    used.add(name);
    // level 0: photos and PDFs are already compressed
    entries[name] = new Uint8Array(await data.arrayBuffer());
    index.push([tx.date, tx.description ?? "", tx.merchant ?? "", tx.category?.name ?? "", tx.villa.name, String(tx.amount), tx.currency, name]);
  }
  const csv = index.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n");
  entries["index.csv"] = new TextEncoder().encode(`﻿${csv}\r\n`);

  const zip = zipSync(entries, { level: 0 });
  await logDownload(db, result.org.id, "zip", index.length - 1, { month: month ?? null, category: category ?? null, villa: villa ?? null });
  const org = result.org.name.replace(/[^\w-]+/g, "-");
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${[org, category && slug(result.categories.find((c) => c.id === category)?.name ?? "category"), month].filter(Boolean).join("-")}-documents.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}

const slug = (s: string) => s.replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "");
