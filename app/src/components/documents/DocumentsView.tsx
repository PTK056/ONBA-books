import { Archive, ChevronRight, Download, FileText, Folder, Image as ImageIcon, Search } from "lucide-react";
import Link from "next/link";
import { money } from "@/components/overview/format";
import { PageHeader } from "@/components/shell/PageHeader";
import { shortDate } from "@/lib/format/date";
import type { Tx, TxFileLinks } from "@/lib/transactions/data";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MAX_LISTED = 200;

type Sign = (tx: Tx) => Promise<TxFileLinks[]>;

/** Documents as folders: years → months → the month's files. Search lists files across all years. Shared by the page and its dev preview. */
export function DocumentsView({ q, month, year, category, all, categories, admin, villas, sign }: {
  q?: string; month?: string; year?: string; category?: string;
  /** Every entry with a file (narrowed by the search, not by the category). */
  all: Tx[]; categories: { id: string; name: string }[]; admin: boolean; villas: number; sign: Sign;
}) {
  // Categories that have documents, with counts, for the chips (before narrowing to one).
  const docsIn = (id: string | null) => all.filter((t) => (t.category?.id ?? null) === id).reduce((n, t) => n + t.files.length, 0);
  const chips = categories.map((c) => ({ ...c, n: docsIn(c.id) })).filter((c) => c.n > 0).sort((a, b) => b.n - a.n);
  const rows = category ? all.filter((t) => t.category?.id === category) : all;
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
        actions={admin && (
          <Link href="/documents/activity" className="h-9 rounded-lg border border-zinc-300 px-3 text-sm font-medium leading-9 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Activity</Link>
        )}
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <form action="/documents" className="relative md:w-72 md:shrink-0">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input name="q" defaultValue={q} placeholder="Search all documents…" aria-label="Search all documents: supplier, description, amount"
            className="h-10 w-full rounded-lg border border-zinc-300 bg-white pl-9 pr-3 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </form>
        {chips.length > 0 && (
          <div className="-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none]" role="list" aria-label="Categories">
            {[{ id: "", name: "All", n: all.reduce((n, t) => n + t.files.length, 0) }, ...chips].map((c) => {
              const active = (category ?? "") === c.id;
              const keep = [month && `month=${month}`, !month && year && `year=${year}`, q && `q=${encodeURIComponent(q)}`, c.id && `category=${c.id}`].filter(Boolean).join("&");
              return (
                <Link
                  key={c.id || "all"} role="listitem" href={`/documents${keep ? `?${keep}` : ""}`}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-sm ring-1 ${active
                    ? "bg-brand-600 text-white ring-brand-600"
                    : "bg-white text-zinc-700 ring-zinc-950/10 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-white/10"}`}
                >
                  {c.name} <span className={active ? "text-brand-100" : "text-zinc-400"}>{c.n}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {(q || year) && (
        <nav className="flex items-center gap-1 text-sm text-zinc-500" aria-label="Folders">
          <Link href={withCat("")} className="hover:text-zinc-900 dark:hover:text-zinc-100">Documents</Link>
          {q && <><ChevronRight size={14} /><span className="text-zinc-900 dark:text-zinc-100">“{q}”</span></>}
          {!q && year && <><ChevronRight size={14} /><Link href={withCat(`year=${year}`)} className="hover:text-zinc-900 dark:hover:text-zinc-100">{year}</Link></>}
          {!q && month && <><ChevronRight size={14} /><span className="text-zinc-900 dark:text-zinc-100">{MONTHS[+month.slice(5, 7) - 1]}</span></>}
        </nav>
      )}

      {q ? (
        <FileList txs={rows.slice(0, MAX_LISTED)} villas={villas} sign={sign} empty="No document matches this search." />
      ) : category && !month && !year ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">{count(rows)} document{count(rows) === 1 ? "" : "s"} in {categoryName}, all time</p>
            {rows.length > 0 && (
              <a href={zipFor()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 btn-label shadow-sm hover:bg-brand-700">
                <Archive size={15} /> Download all (ZIP)
              </a>
            )}
          </div>
          {years.map((y) => (
            <section key={y} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">{y}</h2>
              <FileList txs={inYear(y)} villas={villas} sign={sign} empty="" />
            </section>
          ))}
        </>
      ) : month ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">{count(inMonth(month))} document{count(inMonth(month)) === 1 ? "" : "s"}</p>
            {inMonth(month).length > 0 && (
              <a href={zipFor(month)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 btn-label shadow-sm hover:bg-brand-700">
                <Archive size={15} /> Download month (ZIP)
              </a>
            )}
          </div>
          <FileList txs={inMonth(month)} villas={villas} sign={sign} empty="No documents this month." />
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
      <Folder size={22} className={count ? "text-brand-600" : "text-zinc-400"} />
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
async function FileList({ txs, villas, sign, empty }: { txs: Tx[]; villas: number; sign: Sign; empty: string }) {
  if (!txs.length) return <div className="card p-10 text-center text-sm text-zinc-500">{empty}</div>;
  const signed = await Promise.all(txs.map(async (tx) => ({ tx, files: await sign(tx) })));
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
