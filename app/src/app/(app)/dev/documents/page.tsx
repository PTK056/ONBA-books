// Development-only preview of the Documents page with synthetic files, no Supabase needed.
// The page's own links lead to the real /documents; add ?year=2026, ?month=2026-09 or ?q=… here to see the other views.

import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DocumentsView } from "@/components/documents/DocumentsView";
import type { Tx, TxFileLinks } from "@/lib/transactions/data";

const CATS = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Cleaning & laundry" },
  { id: "00000000-0000-4000-8000-000000000002", name: "Guest supplies" },
  { id: "00000000-0000-4000-8000-000000000003", name: "Utilities" },
  { id: "00000000-0000-4000-8000-000000000004", name: "Pool & garden" },
];
const SUPPLIERS = [["Kamalis Laundry", "Laundry: bed linen and towels", 0], ["Indomaret", "Coffee, water, toilet paper", 1], ["PLN", "Electricity", 2],
  ["Alfamart Munggu", "Insect sprays", 0], ["Pool Care Bali", "Pool maintenance", 3], ["Ngelinus Tropical", "Whole coconuts", 1]] as const;

const ALL: Tx[] = Array.from({ length: 40 }, (_, i) => {
  const [merchant, description, cat] = SUPPLIERS[i % SUPPLIERS.length];
  const month = 9 - Math.floor(i / 5);
  const date = `${month > 0 ? 2026 : 2025}-${String(month > 0 ? month : month + 12).padStart(2, "0")}-${String(28 - (i % 5) * 5).padStart(2, "0")}`;
  return {
    id: String(i), date, direction: "out", source: "receipt", description, merchant, category: CATS[cat], villa: { id: "v1", name: "Villa One" },
    amount: 50_000 + (i * 37_000) % 900_000, currency: "IDR", fxRate: 1, amountReporting: 0, stayCode: null, splitGroup: null,
    files: [{ id: `f${i}`, path: "", mime: i % 4 ? "image/jpeg" : "application/pdf" }],
  } satisfies Tx;
});

async function sign(tx: Tx): Promise<TxFileLinks[]> {
  return tx.files.map((f) => ({ ...f, name: `${tx.merchant}.jpg`, viewUrl: null, downloadUrl: "#" }));
}

export default function DevDocuments({ searchParams }: PageProps<"/dev/documents">) {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8">
      <Suspense><Preview searchParams={searchParams} /></Suspense>
    </main>
  );
}

async function Preview({ searchParams }: Pick<PageProps<"/dev/documents">, "searchParams">) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const q = one("q")?.toLowerCase();
  const month = one("month");
  return (
    <DocumentsView
      q={q} month={month} year={month?.slice(0, 4) ?? one("year")} category={one("category")}
      all={q ? ALL.filter((t) => `${t.merchant} ${t.description}`.toLowerCase().includes(q)) : ALL}
      categories={CATS} admin villas={1} sign={sign}
    />
  );
}
