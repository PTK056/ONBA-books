import { Archive, FileText, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { money } from "@/components/overview/format";
import { PageHeader } from "@/components/shell/PageHeader";
import { listTransactions, signFiles } from "@/lib/transactions/data";

const PAGE = 60;

export default function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-8">
      <Suspense fallback={<div className="card h-96 animate-pulse" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/documents">, "searchParams">) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const filters = { q: one("q"), month: one("month"), villa: one("villa"), category: one("category"), receipt: "attached" as const };
  const result = await listTransactions(filters);
  if (result.kind === "signed_out") redirect("/login?next=/documents");
  if (result.kind === "no_organization") redirect("/setup");
  const { org, rows, categories } = result;

  const shown = rows.slice(0, PAGE);
  const signed = await Promise.all(shown.map(async (t) => ({ tx: t, files: await signFiles(t) })));
  const count = rows.reduce((n, t) => n + t.files.length, 0);
  const zipHref = filters.month
    ? `/documents/zip?month=${filters.month}${filters.villa ? `&villa=${filters.villa}` : ""}`
    : null;

  return (
    <>
      <PageHeader
        title="Documents"
        description="Every receipt and invoice behind your entries. Open one to download it or share it."
        actions={zipHref
          ? <a href={zipHref} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"><Archive size={15} /> Download month (ZIP)</a>
          : <span className="text-xs text-zinc-500">Pick a month to download all its documents as a ZIP</span>}
      />

      <form className="card grid grid-cols-2 gap-3 p-4 sm:grid-cols-[2fr_1fr_1fr_auto]">
        <label className="relative col-span-2 sm:col-span-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input name="q" defaultValue={filters.q} placeholder="Search supplier, description, amount…" className={`${input} pl-9`} />
        </label>
        <input name="month" type="month" defaultValue={filters.month} aria-label="Month" className={input} />
        <select name="category" defaultValue={filters.category ?? ""} aria-label="Category" className={input}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="h-9 rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Apply</button>
      </form>

      <p className="text-sm text-zinc-500">
        {count} document{count === 1 ? "" : "s"}{rows.length > PAGE && ` · showing the latest ${PAGE} entries, narrow by month or search`}
      </p>

      {signed.length === 0 ? (
        <div className="card p-10 text-center text-sm text-zinc-500">No documents{Object.values(filters).some((v) => v && v !== "attached") ? " match these filters" : " yet"}.</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {signed.flatMap(({ tx, files }) => files.map((f) => (
            <Link key={f.id} href={`/transactions/${tx.id}`} className="card group flex flex-col overflow-hidden hover:ring-emerald-500/40">
              <div className="flex aspect-[4/5] items-center justify-center overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                {f.mime.startsWith("image/") && f.viewUrl
                  // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL
                  ? <img src={f.viewUrl} alt={f.name} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
                  : <FileText size={36} className="text-zinc-400" />}
              </div>
              <div className="flex flex-col gap-0.5 p-3 text-sm">
                <span className="truncate font-medium">{tx.merchant ?? tx.description ?? "Receipt"}</span>
                <span className="flex justify-between gap-2 text-xs text-zinc-500">
                  <span>{tx.date}</span>
                  <span className="tabular-nums">{money(tx.amount, tx.currency)} {tx.currency}</span>
                </span>
                <span className="truncate text-xs text-zinc-400">{tx.category?.name ?? "No category"}{org.villas.length > 1 && ` · ${tx.villa.name}`}</span>
              </div>
            </Link>
          )))}
        </div>
      )}
    </>
  );
}

const input = "h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900";
