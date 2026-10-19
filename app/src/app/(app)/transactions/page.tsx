import { Paperclip, Plus, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { money } from "@/components/overview/format";
import { PageHeader } from "@/components/shell/PageHeader";
import { listTransactions, needsReceipt, type TxFilters } from "@/lib/transactions/data";

const SOURCES: Record<string, string> = { manual: "Added by hand", receipt: "From a receipt", stay: "Imported stay", adjustment: "Adjustment" };

export default function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-8">
      <Suspense fallback={<div className="card h-96 animate-pulse" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/transactions">, "searchParams">) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const filters: TxFilters = {
    q: one("q"), month: one("month"), villa: one("villa"), category: one("category"), source: one("source"),
    direction: one("type") === "income" ? "in" : one("type") === "expense" ? "out" : undefined,
    receipt: one("receipt") === "missing" ? "missing" : one("receipt") === "attached" ? "attached" : undefined,
  };
  const result = await listTransactions(filters);
  if (result.kind === "signed_out") redirect("/login?next=/transactions");
  if (result.kind === "no_organization") redirect("/setup");
  const { org, rows, categories, truncated } = result;
  const cur = org.reportingCurrency;
  const editor = org.role !== "owner_viewer";
  const income = rows.filter((r) => r.direction === "in").reduce((s, r) => s + r.amountReporting, 0);
  const expenses = rows.filter((r) => r.direction === "out").reduce((s, r) => s + r.amountReporting, 0);
  const missing = rows.filter((r) => needsReceipt(r) && !r.files.length).length;
  const filtered = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every validated entry, with its receipt."
        actions={editor && (
          <>
            <Link href="/transactions/new?type=income" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium shadow-sm ring-1 ring-zinc-950/10 hover:bg-zinc-50 dark:bg-zinc-900 dark:ring-white/10"><Plus size={15} /> Add income</Link>
            <Link href="/transactions/new" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"><Plus size={15} /> Add expense</Link>
          </>
        )}
      />

      <form className="card grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
        <label className="relative col-span-2 sm:col-span-3 lg:col-span-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input name="q" defaultValue={filters.q} placeholder="Search supplier, description, amount…" className={`${input} pl-9`} />
        </label>
        <input name="month" type="month" defaultValue={filters.month} aria-label="Month" className={input} />
        <select name="type" defaultValue={one("type") ?? ""} aria-label="Type" className={input}>
          <option value="">Income & expenses</option><option value="expense">Expenses</option><option value="income">Income</option>
        </select>
        <select name="category" defaultValue={filters.category ?? ""} aria-label="Category" className={input}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="receipt" defaultValue={filters.receipt ?? ""} aria-label="Receipt" className={input}>
          <option value="">Any receipt status</option><option value="missing">Receipt missing</option><option value="attached">Receipt attached</option>
        </select>
        <div className="flex gap-2">
          <button className="h-9 rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Apply</button>
          {filtered && <Link href="/transactions" className="flex h-9 items-center rounded-lg px-2 text-sm text-zinc-500 hover:text-zinc-900">Clear</Link>}
        </div>
        {org.villas.length > 1 && (
          <select name="villa" defaultValue={filters.villa ?? ""} aria-label="Villa" className={input}>
            <option value="">All villas</option>
            {org.villas.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
        <span><b className="tabular-nums text-zinc-900 dark:text-zinc-100">{rows.length}</b> entries{truncated && " (latest shown, narrow the filters)"}</span>
        <span>Income <b className="tabular-nums text-zinc-900 dark:text-zinc-100">{money(income, cur)}</b></span>
        <span>Expenses <b className="tabular-nums text-zinc-900 dark:text-zinc-100">{money(expenses, cur)}</b></span>
        {missing > 0 && <Link href="/transactions?receipt=missing" className="text-amber-700 hover:underline dark:text-amber-300">{missing} without a receipt</Link>}
        <span className="ml-auto text-xs">{cur}</span>
      </div>

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
                  {org.villas.length > 1 && <th className="hidden px-3 py-2.5 font-normal lg:table-cell">Villa</th>}
                  <th className="px-3 py-2.5 text-right font-normal">Amount</th>
                  <th className="px-5 py-2.5 text-right font-normal">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="group border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/60">
                    <td className="whitespace-nowrap px-5 py-3 text-zinc-500"><Link href={`/transactions/${t.id}`} className="block">{t.date}</Link></td>
                    <td className="px-3 py-3">
                      <Link href={`/transactions/${t.id}`} className="block">
                        <span className="block font-medium text-zinc-900 group-hover:underline dark:text-zinc-100">{t.description ?? t.merchant ?? "—"}</span>
                        <span className="block text-xs text-zinc-500">{[t.merchant !== t.description ? t.merchant : null, SOURCES[t.source]].filter(Boolean).join(" · ")}</span>
                      </Link>
                    </td>
                    <td className="hidden px-3 py-3 text-zinc-600 md:table-cell dark:text-zinc-400">{t.category?.name ?? "—"}</td>
                    {org.villas.length > 1 && <td className="hidden px-3 py-3 text-zinc-600 lg:table-cell dark:text-zinc-400">{t.villa.name}</td>}
                    <td className={`whitespace-nowrap px-3 py-3 text-right tabular-nums ${t.direction === "in" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
                      {t.direction === "in" ? "+" : "−"}{money(t.amountReporting, cur)}
                      {t.currency !== cur && <span className="block text-xs text-zinc-500">{money(t.amount, t.currency)} {t.currency}</span>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {t.files.length > 0
                        ? <span className="inline-flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300"><Paperclip size={12} />{t.files.length > 1 ? t.files.length : ""}</span>
                        : needsReceipt(t)
                          ? <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">Missing</span>
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

const input = "h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900";
