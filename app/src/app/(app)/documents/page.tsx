import { Archive, ChevronRight, Download, FileText, Folder, Image as ImageIcon, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { money } from "@/components/overview/format";
import { PageHeader } from "@/components/shell/PageHeader";
import { shortDate } from "@/lib/format/date";
import { listTransactions, signFiles, type Tx } from "@/lib/transactions/data";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MAX_LISTED = 200;

export default function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8">
      <Suspense fallback={<div className="card h-96 animate-pulse" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** Documents as folders: years → months → the month's files. Search lists files across all years. */
async function Content({ searchParams }: Pick<PageProps<"/documents">, "searchParams">) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const q = one("q");
  const month = one("month")?.match(/^\d{4}-\d{2}$/)?.[0];
  const category = one("category")?.match(/^[0-9a-f-]{36}$/i)?.[0];
  const year = month?.slice(0, 4) ?? one("year")?.match(/^\d{4}$/)?.[0];

  const result = await listTransactions({ receipt: "attached", q });
  if (result.kind === "signed_out") redirect("/login?next=/documents");
  if (result.kind === "no_organization") redirect("/setup");
  const { org } = result;
  // Categories that have documents, with counts, for the chips (before narrowing to one).
  const docsIn = (id: string | null) => result.rows.filter((t) => (t.category?.id ?? null) === id).reduce((n, t) => n + t.files.length, 0);
  const chips = result.categories.map((c) => ({ ...c, n: docsIn(c.id) })).filter((c) => c.n > 0).sort((a, b) => b.n - a.n);
  const rows = category ? result.rows.filter((t) => t.category?.id === category) : result.rows;
  const categoryName = chips.find((c) => c.id === category)?.name;
  const withCat = (params: string) => `/documents?${[params, category && `category=${category}`].filter(Boolean).join("&")}`;
  const zipFor = (m?: string) => `/documents/zip?${[m && `month=${m}`, category && `category=${category}`].filter(Boolean).join("&")}`;

  const count = (txs: Tx[]) => txs.reduce((n, t) => n + t.files.length, 0);
  const inYear = (y: string) => rows.filter((t) => t.date.startsWith(y));
  const inMonth = (m: string) => rows.filter((t) => t.date.startsWith(m));
  const years = [...new Set(rows.map((t) => t.date.slice(0, 4)))].sort().reverse();

  return (
    <>
      <PageHeader
        title="Documents"
        description="Every receipt and invoice behind your entries, filed by month."
        actions={
          <form action="/documents" className="flex items-center gap-2">
            {org.role === "admin" && (
              <Link href="/documents/activity" className="h-9 rounded-lg border border-zinc-300 px-3 text-sm font-medium leading-9 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Activity</Link>
            )}
            {category && <input type="hidden" name="category" value={category} />}
            <input name="month" type="month" defaultValue={month} aria-label="Go to month" className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
            <button className="h-9 rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Open</button>
          </form>
        }
      />

      <form action="/documents" className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input name="q" defaultValue={q} placeholder="Search all documents: supplier, description, amount…" className="h-10 w-full rounded-lg border border-zinc-300 bg-white pl-9 pr-3 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </form>

      {chips.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="list" aria-label="Categories">
          {[{ id: "", name: "All categories", n: result.rows.reduce((n, t) => n + t.files.length, 0) }, ...chips].map((c) => {
            const active = (category ?? "") === c.id;
            const keep = [month && `month=${month}`, !month && year && `year=${year}`, q && `q=${encodeURIComponent(q)}`, c.id && `category=${c.id}`].filter(Boolean).join("&");
            return (
              <Link
                key={c.id || "all"} role="listitem" href={`/documents${keep ? `?${keep}` : ""}`}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm ring-1 ${active
                  ? "bg-emerald-600 text-white ring-emerald-600"
                  : "bg-white text-zinc-700 ring-zinc-950/10 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-white/10"}`}
              >
                {c.name} <span className={active ? "text-emerald-100" : "text-zinc-400"}>{c.n}</span>
              </Link>
            );
          })}
        </div>
      )}

      <nav className="flex items-center gap-1 text-sm text-zinc-500" aria-label="Folders">
        <Link href={withCat("")} className="hover:text-zinc-900 dark:hover:text-zinc-100">Documents</Link>
        {q && <><ChevronRight size={14} /><span className="text-zinc-900 dark:text-zinc-100">“{q}”</span></>}
        {!q && year && <><ChevronRight size={14} /><Link href={withCat(`year=${year}`)} className="hover:text-zinc-900 dark:hover:text-zinc-100">{year}</Link></>}
        {!q && month && <><ChevronRight size={14} /><span className="text-zinc-900 dark:text-zinc-100">{MONTHS[+month.slice(5, 7) - 1]}</span></>}
      </nav>

      {q ? (
        <FileList txs={rows.slice(0, MAX_LISTED)} villas={org.villas.length} empty="No document matches this search." />
      ) : category && !month && !year ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">{count(rows)} document{count(rows) === 1 ? "" : "s"} in {categoryName}, all time</p>
            {rows.length > 0 && (
              <a href={zipFor()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-700">
                <Archive size={15} /> Download all (ZIP)
              </a>
            )}
          </div>
          {years.map((y) => (
            <section key={y} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">{y}</h2>
              <FileList txs={inYear(y)} villas={org.villas.length} empty="" />
            </section>
          ))}
        </>
      ) : month ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">{count(inMonth(month))} document{count(inMonth(month)) === 1 ? "" : "s"}</p>
            {inMonth(month).length > 0 && (
              <a href={zipFor(month)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-700">
                <Archive size={15} /> Download month (ZIP)
              </a>
            )}
          </div>
          <FileList txs={inMonth(month)} villas={org.villas.length} empty="No documents this month." />
        </>
      ) : year ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {MONTHS.map((name, i) => {
            const m = `${year}-${String(i + 1).padStart(2, "0")}`;
            const n = count(inMonth(m));
            return (
              <FolderCard key={m} href={withCat(`month=${m}`)} title={name} count={n}
                zip={n ? zipFor(m) : undefined} />
            );
          })}
        </div>
      ) : years.length === 0 ? (
        <div className="card p-10 text-center text-sm text-zinc-500">{category ? "No documents in this category." : "No documents yet. Scan receipts or attach them to your entries."}</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {years.map((y) => {
            const months = new Set(inYear(y).map((t) => t.date.slice(5, 7))).size;
            return <FolderCard key={y} href={withCat(`year=${y}`)} title={y} count={count(inYear(y))} note={`${months} month${months === 1 ? "" : "s"}`} />;
          })}
        </div>
      )}
    </>
  );
}

function FolderCard({ href, title, count, note, zip }: { href: string; title: string; count: number; note?: string; zip?: string }) {
  return (
    <div className={`card relative flex flex-col gap-3 p-4 ${count ? "" : "opacity-50"}`}>
      <Link href={href} className="absolute inset-0 rounded-xl" aria-label={`Open ${title}`} />
      <Folder size={22} className={count ? "text-emerald-600" : "text-zinc-400"} />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-xs text-zinc-500">{count} document{count === 1 ? "" : "s"}{note && ` · ${note}`}</p>
      </div>
      {zip && (
        <a href={zip} title="Download as ZIP" className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800">
          <Archive size={16} />
        </a>
      )}
    </div>
  );
}

/** A light list (no previews): the file opens on its entry's page. */
async function FileList({ txs, villas, empty }: { txs: Tx[]; villas: number; empty: string }) {
  if (!txs.length) return <div className="card p-10 text-center text-sm text-zinc-500">{empty}</div>;
  const signed = await Promise.all(txs.map(async (tx) => ({ tx, files: await signFiles(tx) })));
  return (
    <section className="card divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800">
      {signed.flatMap(({ tx, files }) => files.map((f) => (
        <div key={f.id} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
          {f.mime === "application/pdf"
            ? <FileText size={18} className="shrink-0 text-red-500" />
            : <ImageIcon size={18} className="shrink-0 text-sky-500" />}
          <Link href={`/transactions/${tx.id}`} className="min-w-0 flex-1">
            <span className="block truncate font-medium hover:underline">{tx.merchant ?? tx.description ?? "Receipt"}</span>
            <span className="block truncate text-xs text-zinc-500">
              {[tx.merchant && tx.description !== tx.merchant ? tx.description : null, tx.category?.name, villas > 1 ? tx.villa.name : null].filter(Boolean).join(" · ")}
            </span>
          </Link>
          <span className="hidden w-20 shrink-0 text-right text-zinc-500 sm:block">{shortDate(tx.date)}</span>
          <span className="w-32 shrink-0 text-right tabular-nums">{money(tx.amount, tx.currency)} <span className="text-xs text-zinc-400">{tx.currency}</span></span>
          {f.downloadUrl && (
            <a href={f.downloadUrl} title={`Download ${f.name}`} className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800">
              <Download size={16} />
            </a>
          )}
        </div>
      )))}
    </section>
  );
}
