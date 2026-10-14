import { ArrowDownRight, ArrowUpRight, BedDouble, ChevronLeft, ChevronRight, Moon, Plus, ReceiptText, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { CategoryBars } from "@/components/overview/CategoryBars";
import { money, monthLabel } from "@/components/overview/format";
import { MonthClose } from "@/components/overview/MonthClose";
import { OccupancyChart } from "@/components/overview/OccupancyChart";
import { TrendChart } from "@/components/overview/TrendChart";
import type { Overview } from "@/lib/overview/data";
import "@/components/overview/chart.css";

const ENTRIES_SHOWN = 12;

/** The overview of one month, from data loaded by the page (or fixtures in the dev preview). */
export function OverviewView({ data: o }: { data: Overview }) {
  const cur = o.org.reportingCurrency;
  const empty = o.trend.every((t) => !t.income && !t.expenses);
  const editor = o.org.role !== "owner_viewer";
  const monthName = monthLabel(o.month, "long").split(" ")[0];
  const margin = o.totals.income ? o.totals.net / o.totals.income : null;
  const occ = o.occupancy[o.occupancy.length - 1];
  const occPrev = o.occupancy[o.occupancy.length - 2];
  const hasStays = o.occupancy.some((m) => m.booked > 0);

  return (
    <>
      <div className="viz-root mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-8">
        <PageHeader
          title="Overview"
          description={`${o.org.name} · figures in ${cur}`}
          actions={
            <>
              <MonthNav month={o.month} />
              {editor && (
                <Link href="/upload" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-700">
                  <Plus size={16} /> Add receipts
                </Link>
              )}
            </>
          }
        />
        <div className="-mt-2 flex flex-wrap items-center justify-between gap-3">
          {editor && (o.toReview > 0 || o.toRead > 0 || o.missingEvidence.length > 0) && (
            <div className="flex flex-wrap gap-2 text-sm">
              {o.toReview > 0 && <Action href="/review">{o.toReview} receipt{o.toReview === 1 ? "" : "s"} to review</Action>}
              {o.toRead > 0 && <Action href="/review">{o.toRead} waiting to be read</Action>}
              {o.missingEvidence.length > 0 && <Action href="#missing">{o.missingEvidence.length} without a receipt</Action>}
            </div>
          )}
        </div>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Income" icon={<TrendingUp size={16} />} tint="blue" value={o.totals.income} previous={o.previous.income} currency={cur} goodWhenUp />
          <Stat label="Expenses" icon={<TrendingDown size={16} />} tint="orange" value={o.totals.expenses} previous={o.previous.expenses} currency={cur} goodWhenUp={false} />
          <Stat label="Net result" icon={<Wallet size={16} />} tint="emerald" value={o.totals.net} previous={o.previous.net} currency={cur} goodWhenUp
            note={margin !== null ? `${Math.round(margin * 100)}% margin` : undefined} />
          <OccupancyStat current={occ} previous={occPrev} />
          <Stat label="Nightly rate" icon={<Moon size={16} />} tint="violet" value={occ.adr ?? 0} previous={occPrev.adr ?? 0} currency={cur} goodWhenUp
            note={occ.booked ? `RevPAR ${money(occ.revpar, cur)}` : "No nights booked"} />
          <Coverage expenses={o.evidence.expenses} withReceipt={o.evidence.withReceipt} />
        </section>
        {o.totals.income === 0 && o.totals.expenses > 0 && (
          <p className="-mt-3 text-xs text-zinc-500">No income yet: the Airbnb stays import comes next.</p>
        )}

        {empty ? (
          <div className="card flex flex-col items-center p-12 text-center">
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950"><ReceiptText size={20} /></span>
            <p className="font-medium">No validated entries yet</p>
            <p className="mt-1 text-sm text-zinc-500">Add receipts, review them, and your months fill in here.</p>
            <Link href="/upload" className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"><Plus size={16} /> Add receipts</Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Panel title="Last 12 months"><TrendChart trend={o.trend} currency={cur} selected={o.month} /></Panel>
              <YearPanel year={o.year} currency={cur} />
            </div>

            {hasStays && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <Panel title="Occupancy · last 12 months"><OccupancyChart months={o.occupancy} currency={cur} selected={o.month} /></Panel>
                <StaysPanel month={occ} monthName={monthName} currency={cur} />
              </div>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Panel title={`Expenses by category · ${monthLabel(o.month, "short")}`}>
                <CategoryBars categories={o.categories} currency={cur} />
              </Panel>
              <div className="flex flex-col gap-6">
                <Panel title="Top suppliers"><Suppliers merchants={o.merchants} currency={cur} /></Panel>
                <Panel title={`${monthName} status`}>
                  <div className="flex flex-col gap-3">
                    {o.villas.map((v) => (
                      <MonthClose
                        key={v.id} villaId={v.id} villaName={v.name} month={o.month} monthName={monthName}
                        closed={Boolean(v.closed)} canEdit={o.org.role === "admin"}
                        warnings={[
                          ...(o.toReview ? [`${o.toReview} receipt${o.toReview === 1 ? "" : "s"} still to review`] : []),
                          ...(o.toRead ? [`${o.toRead} receipt${o.toRead === 1 ? "" : "s"} not read yet`] : []),
                          ...(o.missingEvidence.length ? [`${o.missingEvidence.length} expense${o.missingEvidence.length === 1 ? "" : "s"} without a receipt`] : []),
                        ]}
                      />
                    ))}
                  </div>
                </Panel>
              </div>
            </div>

            <Panel title={`${monthName} entries · ${o.entries.length}`}>
              <EntriesTable entries={o.entries} currency={cur} showVilla={o.villas.length > 1} />
            </Panel>
          </>
        )}

        {o.villas.length > 1 && <VillaTable villas={o.villas} currency={cur} />}
        {o.missingEvidence.length > 0 && <MissingEvidence rows={o.missingEvidence} />}
      </div>
    </>
  );
}

function MonthNav({ month }: { month: string }) {
  const d = new Date(`${month}T00:00:00Z`);
  const shift = (n: number) => {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
    return `/overview?month=${m.toISOString().slice(0, 7)}`;
  };
  const btn = "flex h-9 w-9 items-center justify-center text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";
  return (
    <div className="card flex items-center overflow-hidden">
      <Link href={shift(-1)} aria-label="Previous month" className={btn}><ChevronLeft size={16} /></Link>
      <span className="min-w-36 border-x border-zinc-100 px-3 text-center text-sm font-medium dark:border-zinc-800">{monthLabel(month)}</span>
      <Link href={shift(1)} aria-label="Next month" className={btn}><ChevronRight size={16} /></Link>
    </div>
  );
}

const TINTS = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300",
  orange: "bg-orange-50 text-orange-600 dark:bg-orange-950 dark:text-orange-300",
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300",
  violet: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
} as const;

function Stat({ label, icon, tint, value, previous, currency, goodWhenUp, note }: {
  label: string; icon: React.ReactNode; tint: keyof typeof TINTS; value: number; previous: number;
  currency: string; goodWhenUp: boolean; note?: string;
}) {
  const change = previous ? (value - previous) / Math.abs(previous) : null;
  const good = change !== null && change !== 0 && (change > 0) === goodWhenUp;
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-500">{label}</p>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${TINTS[tint]}`}>{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
        {money(value, currency)} <span className="whitespace-nowrap text-sm font-normal text-zinc-400">{currency}</span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {change === null ? (
          <span className="text-zinc-400">No figures last month</span>
        ) : (
          <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium ${
            change === 0 ? TINTS.zinc
              : good ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300"}`}>
            {change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(Math.round(change * 100))}%
          </span>
        )}
        {change !== null && <span className="text-zinc-400">vs last month</span>}
        {note && <span className="text-zinc-500">· {note}</span>}
      </div>
    </div>
  );
}

function Coverage({ expenses, withReceipt }: { expenses: number; withReceipt: number }) {
  const pct = expenses ? Math.round((withReceipt / expenses) * 100) : null;
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-500">Backed by a receipt</p>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${TINTS.zinc}`}><ReceiptText size={16} /></span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{pct === null ? "—" : `${pct}%`}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <p className="mt-2 text-xs text-zinc-400">{withReceipt} of {expenses} expense{expenses === 1 ? "" : "s"}</p>
    </div>
  );
}

function OccupancyStat({ current, previous }: { current: Overview["occupancy"][number]; previous: Overview["occupancy"][number] }) {
  const points = previous.available ? Math.round((current.occupancy - previous.occupancy) * 100) : null;
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-500">Occupancy</p>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${TINTS.violet}`}><BedDouble size={16} /></span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
        {Math.round(current.occupancy * 100)}% <span className="text-sm font-normal text-zinc-400">{current.booked} of {current.available} nights</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full rounded-full" style={{ width: `${current.occupancy * 100}%`, background: "var(--series-occupancy)" }} />
      </div>
      <p className="mt-2 text-xs text-zinc-400">
        {points === null ? "No figures last month" : `${points >= 0 ? "+" : "−"}${Math.abs(points)} pts vs last month`}
      </p>
    </div>
  );
}

function StaysPanel({ month, monthName, currency }: { month: Overview["occupancy"][number]; monthName: string; currency: string }) {
  const rows: [string, string][] = [
    ["Nights booked", `${month.booked} of ${month.available}`],
    ["Occupancy", `${Math.round(month.occupancy * 100)}%`],
    ["Income from stays", money(month.stayIncome, currency)],
    ["Average nightly rate", month.adr === null ? "—" : money(month.adr, currency)],
    ["RevPAR", money(month.revpar, currency)],
  ];
  return (
    <Panel title={`Stays · ${monthName}`}>
      <dl className="flex flex-col gap-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-zinc-100 pb-2 last:border-0 dark:border-zinc-900">
            <dt className="text-zinc-600 dark:text-zinc-400">{k}</dt>
            <dd className="tabular-nums font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-zinc-500">RevPAR: income from stays per available night, booked or not.</p>
    </Panel>
  );
}

function YearPanel({ year, currency }: { year: Overview["year"]; currency: string }) {
  const rows: [string, string][] = [
    ["Income", money(year.income, currency)],
    ["Expenses", money(year.expenses, currency)],
    ["Net", money(year.net, currency)],
    ["Average monthly expenses", money(year.averageExpenses, currency)],
    ...(year.occupancy !== null ? [["Occupancy", `${Math.round(year.occupancy * 100)}%`] as [string, string]] : []),
    ...(year.adr !== null ? [["Average nightly rate", money(year.adr, currency)] as [string, string]] : []),
  ];
  return (
    <Panel title={`Year to date · since ${monthLabel(year.from)}`}>
      <dl className="flex flex-col gap-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-zinc-100 pb-2 last:border-0 dark:border-zinc-900">
            <dt className="text-zinc-600 dark:text-zinc-400">{k}</dt>
            <dd className="tabular-nums font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-zinc-500">
        {year.months} month{year.months === 1 ? "" : "s"} with entries
        {year.costliest && year.costliest.expenses > 0 && <> · costliest: {monthLabel(year.costliest.month)} ({money(year.costliest.expenses, currency)})</>}
      </p>
    </Panel>
  );
}

function Suppliers({ merchants, currency }: { merchants: Overview["merchants"]; currency: string }) {
  if (!merchants.length) return <p className="text-sm text-zinc-500">No supplier names on this month&apos;s receipts.</p>;
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {merchants.map((m) => (
        <li key={m.name} className="flex justify-between gap-3">
          <span className="truncate">{m.name} <span className="text-xs text-zinc-500">×{m.count}</span></span>
          <span className="shrink-0 tabular-nums">{money(m.amount, currency)}</span>
        </li>
      ))}
    </ul>
  );
}

function EntriesTable({ entries, currency, showVilla }: { entries: Overview["entries"]; currency: string; showVilla: boolean }) {
  if (!entries.length) return <p className="text-sm text-zinc-500">No entries this month.</p>;
  const row = (e: Overview["entries"][number]) => (
    <tr key={e.id} className="border-t border-zinc-100 align-top dark:border-zinc-900">
      <td className="whitespace-nowrap py-2 pr-3 text-zinc-500">{e.date.slice(8)} {monthLabel(`${e.date.slice(0, 7)}-01`, "short")}</td>
      <td className="min-w-40 py-2 pr-3">
        <span className="block">{e.description ?? "—"}</span>
        {e.merchant && <span className="block text-xs text-zinc-500">{e.merchant}</span>}
      </td>
      <td className="hidden py-2 pr-3 text-zinc-600 sm:table-cell dark:text-zinc-400">{e.category}</td>
      {showVilla && <td className="hidden py-2 pr-3 text-zinc-600 md:table-cell dark:text-zinc-400">{e.villa}</td>}
      <td className="whitespace-nowrap py-2 text-right tabular-nums">
        {e.direction === "in" ? "+" : "−"}{money(e.amount, currency)}
        {e.original && <span className="block text-xs text-zinc-500">{money(e.original.amount, e.original.currency)} {e.original.currency}</span>}
      </td>
      <td className="py-2 pl-3 text-right">
        {e.receiptUrl
          ? <a href={e.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800"><ReceiptText size={12} /> View</a>
          : <span className="inline-flex rounded-md bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">Missing</span>}
      </td>
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-zinc-500">
          <tr>
            <th className="pb-1 font-normal">Date</th>
            <th className="pb-1 font-normal">Description</th>
            <th className="hidden pb-1 font-normal sm:table-cell">Category</th>
            {showVilla && <th className="hidden pb-1 font-normal md:table-cell">Villa</th>}
            <th className="pb-1 text-right font-normal">{currency}</th>
            <th />
          </tr>
        </thead>
        <tbody>{entries.slice(0, ENTRIES_SHOWN).map(row)}</tbody>
      </table>
      {entries.length > ENTRIES_SHOWN && (
        <details className="text-sm">
          <summary className="mt-2 cursor-pointer text-zinc-500">Show all {entries.length} entries</summary>
          <table className="w-full"><tbody>{entries.slice(ENTRIES_SHOWN).map(row)}</tbody></table>
        </details>
      )}
    </div>
  );
}

function Action({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900">
      {children} <ChevronRight size={14} />
    </Link>
  );
}

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function VillaTable({ villas, currency }: { villas: Overview["villas"]; currency: string }) {
  return (
    <Panel title="By villa">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-left text-xs text-zinc-500">
          <tr><th className="font-normal">Villa</th><th className="text-right font-normal">Occupancy</th><th className="text-right font-normal">Nightly rate</th><th className="text-right font-normal">Income</th><th className="text-right font-normal">Expenses</th><th className="text-right font-normal">Net</th></tr>
        </thead>
        <tbody>
          {villas.map((v) => (
            <tr key={v.id} className="border-t border-zinc-100 dark:border-zinc-900">
              <td className="py-1.5">{v.name}</td>
              <td className="text-right">{Math.round(v.occupancy * 100)}% <span className="text-xs text-zinc-400">{v.booked}/{v.available}</span></td>
              <td className="text-right">{v.adr === null ? "—" : money(v.adr, currency)}</td>
              <td className="text-right">{money(v.income, currency)}</td>
              <td className="text-right">{money(v.expenses, currency)}</td>
              <td className="text-right font-medium">{money(v.net, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function MissingEvidence({ rows }: { rows: Overview["missingEvidence"] }) {
  return (
    <section id="missing">
      <Panel title="Expenses without a receipt">
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-900">
          {rows.map((r) => (
            <li key={r.id} className="flex justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate"><span className="text-zinc-500">{r.date.slice(8)} {monthLabel(`${r.date.slice(0, 7)}-01`, "short")}</span> · {r.description ?? "No description"}</span>
              <span className="shrink-0 tabular-nums">{money(r.amount, r.currency)} {r.currency}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  );
}
