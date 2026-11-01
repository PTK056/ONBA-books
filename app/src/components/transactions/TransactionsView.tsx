import { Paperclip, Search, SlidersHorizontal, Wallet } from "lucide-react";
import Link from "next/link";
import { money } from "@/components/overview/format";
import { Highlight, MiniStat } from "@/components/shell/Highlight";
import { NewMenu } from "@/components/shell/NewMenu";
import { PageHeader } from "@/components/shell/PageHeader";
import { shortDate } from "@/lib/format/date";
import { needsReceipt, type Tx, type TxFilters } from "@/lib/transactions/data";

const SOURCES: Record<string, string> = { manual: "Added by hand", receipt: "From a receipt", stay: "Imported stay", adjustment: "Adjustment", module: "From a bank statement" };
const field = "h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const input = `${field} w-full`;

type Option = { id: string; name: string };

/** Every validated entry with its receipt, and the filters over them. Shared by the page and its dev preview. */
export function TransactionsView({ filters, type, rows, truncated, categories, villa, places, showVilla, editor, currency: cur }: {
  filters: TxFilters; type?: string; rows: Tx[]; truncated: boolean; categories: Option[];
  villa: string | null; places: Option[]; showVilla: boolean; editor: boolean; currency: string;
}) {
  const income = rows.filter((r) => r.direction === "in").reduce((s, r) => s + r.amountReporting, 0);
  const expenses = rows.filter((r) => r.direction === "out").reduce((s, r) => s + r.amountReporting, 0);
  const missing = rows.filter((r) => needsReceipt(r) && !r.files.length).length;
  const filtered = Object.values(filters).some(Boolean);
  // Category, receipt and villa wait behind "Filters"; the panel opens by itself when one of them is set.
  const toggled = "[.peer:checked~div_&]:bg-zinc-100 dark:[.peer:checked~div_&]:bg-zinc-800";
  const more = [filters.category, filters.receipt, filters.villa && filters.villa !== "all" ? filters.villa : undefined].filter(Boolean).length;

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every validated entry, with its receipt."
        actions={editor && <NewMenu />}
      />

      <form className="flex flex-col gap-2">
        {/* Unnamed, so never sent: it only shows the second row. Fields in a hidden row are still sent. */}
        <input id="more-filters" type="checkbox" defaultChecked={more > 0} className="peer sr-only" />
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-56 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input name="q" defaultValue={filters.q} placeholder="Search supplier, description, amount…" className={`${input} pl-9`} />
          </label>
          <input name="month" type="month" defaultValue={filters.month} aria-label="Month" className={`${field} w-40`} />
          <select name="type" defaultValue={type ?? ""} aria-label="Type" className={`${field} w-44`}>
            <option value="">Income & expenses</option><option value="expense">Expenses</option><option value="income">Income</option>
          </select>
          <label htmlFor="more-filters" className={`inline-flex h-9 cursor-pointer select-none items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 ${toggled}`}>
            <SlidersHorizontal size={14} /> Filters{more > 0 && <span className="text-zinc-400">· {more}</span>}
          </label>
          <button className="h-9 rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Apply</button>
          {filtered && <Link href="/transactions" className="flex h-9 items-center px-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">Clear</Link>}
        </div>
        <div className="hidden gap-2 peer-checked:grid sm:grid-cols-3">
          <select name="category" defaultValue={filters.category ?? ""} aria-label="Category" className={input}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select name="receipt" defaultValue={filters.receipt ?? ""} aria-label="Receipt" className={input}>
            <option value="">Any receipt status</option><option value="missing">Receipt missing</option><option value="attached">Receipt attached</option>
          </select>
          {showVilla && (
            <select name="villa" defaultValue={villa ?? "all"} aria-label="Villa" className={input}>
              <option value="all">All villas</option>
              {places.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
        </div>
      </form>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Highlight
          className="col-span-2" label={filtered ? "Net for these filters" : "Net result"} icon={<Wallet size={16} />}
          value={money(income - expenses, cur)} unit={cur}
          note={`${rows.length} entries${truncated ? " (latest shown, narrow the filters)" : ""}`}
        />
        <MiniStat label="Income" value={money(income, cur)} unit={cur} />
        <MiniStat label="Expenses" value={money(expenses, cur)} unit={cur}>
          {missing > 0 && <Link href="/transactions?receipt=missing" className="text-amber-700 hover:underline dark:text-amber-300">{missing} without a receipt</Link>}
        </MiniStat>
      </section>

      <section className="card overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-zinc-500">{filtered ? "Nothing matches these filters." : "No entries yet."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-5 py-2.5 font-normal">Date</th>
                  <th className="px-3 py-2.5 font-normal">Description</th>
                  <th className="hidden px-3 py-2.5 font-normal md:table-cell">Category</th>
                  {showVilla && <th className="hidden px-3 py-2.5 font-normal lg:table-cell">Villa</th>}
                  <th className="px-3 py-2.5 text-right font-normal">Amount</th>
                  <th className="px-5 py-2.5 text-right font-normal">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="group border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/60">
                    <td className="whitespace-nowrap px-5 py-3 text-zinc-500"><Link href={`/transactions/${t.id}`} className="block">{shortDate(t.date)}</Link></td>
                    <td className="px-3 py-3">
                      <Link href={`/transactions/${t.id}`} className="block">
                        <span className="block font-medium text-zinc-900 group-hover:underline dark:text-zinc-100">{t.description ?? t.merchant ?? "—"}</span>
                        <span className="block text-xs text-zinc-500">{[t.merchant !== t.description ? t.merchant : null, SOURCES[t.source]].filter(Boolean).join(" · ")}</span>
                      </Link>
                    </td>
                    <td className="hidden px-3 py-3 text-zinc-600 md:table-cell dark:text-zinc-400">{t.category?.name ?? "—"}</td>
                    {showVilla && <td className="hidden px-3 py-3 text-zinc-600 lg:table-cell dark:text-zinc-400">{t.villa.name}</td>}
                    <td className={`whitespace-nowrap px-3 py-3 text-right tabular-nums ${t.direction === "in" ? "text-brand-700 dark:text-brand-400" : ""}`}>
                      {t.direction === "in" ? "+" : "−"}{money(t.amountReporting, cur)}
                      {t.currency !== cur && <span className="block text-xs text-zinc-500">{money(t.amount, t.currency)} {t.currency}</span>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {t.files.length > 0
                        ? <span className="inline-flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300"><Paperclip size={12} />{t.files.length > 1 ? t.files.length : ""}</span>
                        : needsReceipt(t)
                          ? <span className="bg-amber-50 px-1.5 py-0.5 badge-label text-amber-700 dark:bg-amber-950 dark:text-amber-300">Missing</span>
                          : <span className="text-xs text-zinc-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
