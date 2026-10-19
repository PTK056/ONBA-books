import { BedDouble, CheckCircle2, ChevronRight, CircleAlert, Moon, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import { CategoryBars } from "@/components/overview/CategoryBars";
import { money } from "@/components/overview/format";
import { Panel, SectionTitle, Stat, Suppliers, TINTS } from "@/components/overview/OverviewView";
import { PeriodSwitch, YearNav } from "@/components/overview/PeriodSwitch";
import { TrendTabs } from "@/components/overview/TrendTabs";
import { NewMenu } from "@/components/shell/NewMenu";
import { PageHeader } from "@/components/shell/PageHeader";
import type { PeriodOverview } from "@/lib/overview/period";
import "@/components/overview/chart.css";

/** A year (month by month) or all time (year by year). */
export function PeriodView({ data: p }: { data: PeriodOverview }) {
  const cur = p.org.reportingCurrency;
  const editor = p.org.role !== "owner_viewer";
  const name = p.year ?? "All time";
  const margin = p.totals.income ? p.totals.net / p.totals.income : null;
  const hasStays = p.buckets.some((b) => b.booked > 0);
  const bucketName = p.kind === "year" ? "Month" : "Year";
  const todo = editor && (p.toReview > 0 || p.toRead > 0 || p.missingReceipts > 0);

  return (
    <div className="viz-root mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-8">
      <PageHeader
        title="Overview"
        description={`${p.org.name} · ${p.kind === "year" ? `year ${p.year}` : "since the first entry"} · figures in ${cur}`}
        actions={
          <>
            <PeriodSwitch view={p.kind} year={p.year ?? p.years[0]} />
            {p.kind === "year" && p.year && <YearNav year={p.year} years={p.years} />}
            {editor && <NewMenu />}
          </>
        }
      />

      {todo && (
        <section className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4 text-sm">
          <span className="flex items-center gap-1.5 font-medium"><CircleAlert size={16} className="text-amber-500" /> To do</span>
          {p.toReview > 0 && <Chip href="/review">{p.toReview} receipt{p.toReview === 1 ? "" : "s"} to review</Chip>}
          {p.toRead > 0 && <Chip href="/review">{p.toRead} waiting to be read</Chip>}
          {p.missingReceipts > 0 && <Chip href="/transactions?receipt=missing">{p.missingReceipts} receipt{p.missingReceipts === 1 ? "" : "s"} missing in {name}</Chip>}
        </section>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Income" icon={<TrendingUp size={16} />} tint="blue" value={p.totals.income} previous={0} currency={cur} goodWhenUp hideChange />
        <Stat label="Expenses" icon={<TrendingDown size={16} />} tint="orange" value={p.totals.expenses} previous={0} currency={cur} goodWhenUp={false} hideChange
          note={p.totals.platformFees ? `incl. ${money(p.totals.platformFees, cur)} platform fees` : undefined} />
        <Stat label="Net result" icon={<Wallet size={16} />} tint="emerald" value={p.totals.net} previous={0} currency={cur} goodWhenUp hideChange
          note={margin !== null ? `${Math.round(margin * 100)}% margin` : undefined} />
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-500">Occupancy</p>
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${TINTS.violet}`}><BedDouble size={16} /></span>
          </div>
          <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{Math.round(p.occupancy.rate * 100)}%</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div className="h-full rounded-full" style={{ width: `${p.occupancy.rate * 100}%`, background: "var(--series-occupancy)" }} />
          </div>
          <p className="mt-2 text-xs text-zinc-400">{p.occupancy.booked} of {p.occupancy.available} nights</p>
        </div>
        <Stat label="Nightly rate" icon={<Moon size={16} />} tint="violet" value={p.occupancy.adr ?? 0} previous={0} currency={cur} goodWhenUp hideChange
          note={`RevPAR ${money(p.occupancy.revpar, cur)}`} />
      </section>

      {p.buckets.every((b) => !b.income && !b.expenses) ? (
        <div className="card p-12 text-center text-sm text-zinc-500">No validated entries in {name}.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <TrendTabs
              trend={p.buckets} occupancy={p.buckets} currency={cur} selected="" hasStays={hasStays}
              title={p.kind === "year" ? `${p.year} month by month` : "Year by year"} byYear={p.kind === "all"}
            />
            <StaysSummary p={p} currency={cur} />
          </div>

          <SectionTitle>{p.kind === "year" ? `${p.year} by month` : "By year"}</SectionTitle>
          <section className="card -mt-3 overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-5 py-2.5 font-normal">{bucketName}</th>
                  <th className="px-3 py-2.5 text-right font-normal">Income</th>
                  <th className="px-3 py-2.5 text-right font-normal">Expenses</th>
                  <th className="px-3 py-2.5 text-right font-normal">Net</th>
                  <th className="hidden px-3 py-2.5 text-right font-normal sm:table-cell">Nights</th>
                  <th className="px-3 py-2.5 text-right font-normal">Occupancy</th>
                  <th className="hidden px-5 py-2.5 text-right font-normal md:table-cell">Nightly rate</th>
                </tr>
              </thead>
              <tbody>
                {p.buckets.map((b) => {
                  const emptyRow = !b.income && !b.expenses && !b.booked;
                  return (
                    <tr key={b.month} className={`border-t border-zinc-100 dark:border-zinc-800 ${emptyRow ? "text-zinc-300 dark:text-zinc-700" : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"}`}>
                      <td className="px-5 py-2.5">
                        {emptyRow ? b.label : <Link href={b.href} className="font-medium hover:underline">{b.label}</Link>}
                      </td>
                      <td className="px-3 py-2.5 text-right">{money(b.income, cur)}</td>
                      <td className="px-3 py-2.5 text-right">{money(b.expenses, cur)}</td>
                      <td className={`px-3 py-2.5 text-right font-medium ${b.net < 0 ? "text-rose-600" : ""}`}>{money(b.net, cur)}</td>
                      <td className="hidden px-3 py-2.5 text-right sm:table-cell">{b.booked || "–"}</td>
                      <td className="px-3 py-2.5 text-right">{b.available ? `${Math.round(b.occupancy * 100)}%` : "–"}</td>
                      <td className="hidden px-5 py-2.5 text-right md:table-cell">{b.adr === null ? "–" : money(b.adr, cur)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-200 font-semibold dark:border-zinc-700">
                  <td className="px-5 py-2.5">Total</td>
                  <td className="px-3 py-2.5 text-right">{money(p.totals.income, cur)}</td>
                  <td className="px-3 py-2.5 text-right">{money(p.totals.expenses, cur)}</td>
                  <td className="px-3 py-2.5 text-right">{money(p.totals.net, cur)}</td>
                  <td className="hidden px-3 py-2.5 text-right sm:table-cell">{p.occupancy.booked}</td>
                  <td className="px-3 py-2.5 text-right">{Math.round(p.occupancy.rate * 100)}%</td>
                  <td className="hidden px-5 py-2.5 text-right md:table-cell">{p.occupancy.adr === null ? "–" : money(p.occupancy.adr, cur)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          <SectionTitle>Where the money went · {name}</SectionTitle>
          <div className="-mt-3 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Panel title="Expenses by category"><CategoryBars categories={p.categories} currency={cur} /></Panel>
            <Panel title="Top suppliers"><Suppliers merchants={p.merchants} currency={cur} /></Panel>
          </div>
        </>
      )}
    </div>
  );
}

function StaysSummary({ p, currency }: { p: PeriodOverview; currency: string }) {
  const best = p.stays.bestBucket;
  const rows: [string, string][] = [
    ["Stays", String(p.stays.count)],
    ["Nights booked", `${p.stays.nights} of ${p.occupancy.available}`],
    ["Average stay", p.stays.averageLength === null ? "–" : `${p.stays.averageLength.toFixed(1)} nights`],
    ["Average nightly rate", p.occupancy.adr === null ? "–" : money(p.occupancy.adr, currency)],
    ["Platform fees", money(p.totals.platformFees, currency)],
  ];
  return (
    <Panel title="Stays">
      <dl className="flex flex-col gap-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-zinc-100 pb-2 last:border-0 dark:border-zinc-800">
            <dt className="text-zinc-600 dark:text-zinc-400">{k}</dt>
            <dd className="font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {best && (
        <Link href={best.href} className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-200">
          <CheckCircle2 size={15} /> Best {p.kind === "year" ? "month" : "year"}: <b>{p.kind === "year" ? `${best.label} ${p.year}` : best.label}</b>
          <span className="ml-auto tabular-nums">{money(best.net, currency)}</span>
        </Link>
      )}
    </Panel>
  );
}

function Chip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900">
      {children} <ChevronRight size={13} />
    </Link>
  );
}
