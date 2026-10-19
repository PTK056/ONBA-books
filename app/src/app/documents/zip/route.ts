import { zipSync } from "fflate";
import { type NextRequest } from "next/server";
import { listTransactions } from "@/lib/transactions/data";
import { documentFileName } from "@/lib/transactions/names";
import { createClient } from "@/lib/supabase/server";

const MAX_FILES = 400;

/** GET /documents/zip?month=YYYY-MM[&villa=…] → every document of the month, plus an index. */
export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get("month") ?? "";
  const villa = request.nextUrl.searchParams.get("villa") ?? undefined;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new Response("Choose a month", { status: 400 });

  const result = await listTransactions({ month, villa, receipt: "attached" });
  if (result.kind !== "ready") return new Response("Not signed in", { status: 401 });
  const files = result.rows.flatMap((tx) => tx.files.map((f, i) => ({ tx, f, i: tx.files.length > 1 ? i + 1 : undefined })));
  if (!files.length) return new Response("No documents for this month", { status: 404 });
  if (files.length > MAX_FILES) return new Response("Too many documents; filter by villa", { status: 413 });

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
  const org = result.org.name.replace(/[^\w-]+/g, "-");
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${org}-${month}-documents.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
