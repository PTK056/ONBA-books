"use client";

import { useState } from "react";
import { money as fmt } from "@/components/overview/format";
import { addMonths, type Facts, type MonthFigures } from "@/lib/performance/metrics";
import { bad, good, monthName, shortMonth } from "./ui";
import "@/components/overview/chart.css";

type Key = "occupancy" | "adr" | "income" | "operating";

/**
 * The month's four figures, each with how it moved and a sparkline of the last 13 months. A tap on one opens its
 * month-by-month chart below.
 */
export function Figures({ f, fees }: { f: Facts; fees: string | null }) {
  const [open, setOpen] = useState<Key | null>(null);
  const kpis: { k: Key; label: string }[] = [
    { k: "occupancy", label: "Occupancy" },
    { k: "adr", label: "Rate per night" },
    { k: "income", label: "Income" },
    { k: "operating", label: fees ? `Result before ${fees}` : "Result" },
  ];
  const sel = kpis.find((x) => x.k === open);
  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((x) => <Tile key={x.k} f={f} k={x.k} label={x.label} open={open === x.k} onClick={() => setOpen(open === x.k ? null : x.k)} />)}
      </div>
      {sel && (
        <div className="card p-5">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="font-semibold">{sel.label}, month by month</h2>
            <button className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => setOpen(null)} aria-label="Close">✕</button>
          </div>
          <MonthBars months={f.months} k={sel.k} month={f.month} currency={f.currency} />
        </div>
      )}
    </section>
  );
}

const value = (x: MonthFigures, k: Key): number | null => x[k];
const display = (v: number | null, k: Key, cur: string) =>
  v === null ? "—" : k === "occupancy" ? `${(v * 100).toFixed(1)}%` : fmt(v, cur, true);

function Tile({ f, k, label, open, onClick }: { f: Facts; k: Key; label: string; open: boolean; onClick: () => void }) {
  const v = f.metrics[`month.${k}`]?.value ?? null;
  const ly = f.metrics[`last_year.${k}`]?.value ?? null, p3 = f.metrics[`prev3.${k}`]?.value ?? null;
  const ref = ly ?? p3;
  let delta: { text: string; up: boolean } | null = null;
  if (v !== null && ref !== null) {
    if (k === "occupancy") delta = { text: `${Math.abs((v - ref) * 100).toFixed(0)} pts`, up: v >= ref };
    else if (ref !== 0) delta = { text: `${Math.abs(((v - ref) / Math.abs(ref)) * 100).toFixed(0)}%`, up: v >= ref };
  }
  return (
    <button onClick={onClick} aria-expanded={open}
      className={`card flex flex-col gap-1 p-4 text-left transition hover:ring-2 hover:ring-brand-200 dark:hover:ring-brand-800 ${open ? "ring-2 ring-brand-500" : ""}`}>
      <span className="flex items-center justify-between gap-2 text-sm text-zinc-500">
        <span className="truncate">{label}</span>
        <Spark values={f.months.map((x) => value(x, k))} />
      </span>
      <span className="text-2xl font-semibold tabular-nums">{display(v, k, f.currency)}</span>
      {delta ? (
        <span className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className={`rounded-full px-1.5 py-0.5 font-semibold ${delta.up ? good : bad}`}>{delta.up ? "▲" : "▼"} {delta.text}</span>
          <span className="text-zinc-500">vs {display(ref, k, f.currency)} {ly !== null ? "last year" : "before"}</span>
        </span>
      ) : <span className="text-xs text-zinc-500">&nbsp;</span>}
    </button>
  );
}

/** A tiny line of the last months, the latest one dotted. */
function Spark({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 3) return null;
  const W = 56, H = 18;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  const x = (i: number) => 2 + (i / (values.length - 1)) * (W - 4);
  const y = (v: number) => 2 + (1 - (v - lo) / (hi - lo || 1)) * (H - 4);
  const last = pts.at(-1)!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz-root h-[18px] w-14 shrink-0" aria-hidden>
      <path d={pts.map((p, j) => `${j ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")} fill="none" stroke="var(--series-income)" strokeWidth="1.5" strokeLinejoin="round" opacity="0.7" />
      <circle cx={x(last.i)} cy={y(last.v)} r="2" fill="var(--series-income)" />
    </svg>
  );
}

/** One figure over the last 13 months: the report's month solid, the others light; hover reads a month. */
function MonthBars({ months, k, month, currency }: { months: MonthFigures[]; k: Key; month: string; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const vals = months.map((x) => value(x, k));
  const hi = Math.max(0, ...vals.map((v) => v ?? 0)), lo = Math.min(0, ...vals.map((v) => v ?? 0));
  const span = hi - lo || 1;
  const zero = (hi / span) * 100; // % from the top
  const lastYear = addMonths(month, -12);
  return (
    <figure className="viz-root">
      <div className="relative flex h-44 gap-1">
        <div className="pointer-events-none absolute inset-x-0 border-t" style={{ top: `${zero}%`, borderColor: "var(--grid)" }} />
        {months.map((x, i) => {
          const v = vals[i];
          const h = v === null ? 0 : (Math.abs(v) / span) * 100;
          const isMonth = x.month === month, isLy = x.month === lastYear;
          return (
            <div key={x.month} className={`relative flex-1 rounded ${hover === i ? "bg-zinc-100 dark:bg-zinc-800/60" : ""}`}
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              {v !== null && (
                <div className={`absolute inset-x-[15%] ${v >= 0 ? "rounded-t" : "rounded-b"}`}
                  style={{
                    top: v >= 0 ? `${zero - h}%` : `${zero}%`, height: `max(${h}%, 2px)`,
                    background: v < 0 && !isMonth ? "var(--color-amber-400)" : "var(--series-income)",
                    opacity: isMonth ? 1 : isLy ? 0.6 : 0.3,
                  }} />
              )}
              {isMonth && v !== null && (
                <span className="absolute inset-x-0 text-center text-[11px] font-semibold tabular-nums"
                  style={{ top: v >= 0 ? `calc(${zero - h}% - 1.1rem)` : `calc(${zero + h}% + 0.15rem)` }}>{display(v, k, currency)}</span>
              )}
              {hover === i && (
                <div role="tooltip" className={`absolute top-0 z-10 w-max rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${i >= months.length / 2 ? "right-full mr-1" : "left-full ml-1"}`}>
                  <p className="font-medium">{monthName(x.month)}</p>
                  <p className="tabular-nums">{display(v, k, currency)}{k !== "occupancy" && v !== null ? ` ${currency}` : ""}</p>
                  {k === "occupancy" && <p className="text-zinc-500">{x.sold} of {x.available} nights</p>}
                  {k === "adr" && <p className="text-zinc-500">{x.sold} nights sold</p>}
                  {(k === "income" || k === "operating") && <p className="text-zinc-500">Expenses {fmt(x.expenses, currency, true)}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1">
        {months.map((x) => (
          <span key={x.month} className={`flex-1 text-center text-[10px] ${x.month === month ? "font-semibold" : "text-zinc-500"}`}>
            {shortMonth(x.month)}{x.month.slice(5, 7) === "01" || x.month === months[0].month ? <span className="hidden sm:inline"> {x.month.slice(2, 4)}</span> : null}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Solid: {monthName(month)}{months.some((x) => x.month === lastYear) ? ` · half: ${monthName(lastYear)}, a year before` : ""}.
        {k === "operating" && " The result before costs paid ahead and booked month by month (such as a lease)."}
      </p>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer select-none text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">Show every figure as a table</summary>
        <MonthsTable months={months} currency={currency} />
      </details>
    </figure>
  );
}

function MonthsTable({ months, currency }: { months: MonthFigures[]; currency: string }) {
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(0)}%`);
  const m = (v: number | null) => (v === null ? "—" : fmt(v, currency, true));
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-right text-sm tabular-nums">
        <thead className="text-xs text-zinc-500">
          <tr><th className="text-left font-normal">Month</th><th className="font-normal">Occupancy</th><th className="font-normal">ADR</th><th className="font-normal">Nights</th><th className="font-normal">Income</th><th className="font-normal">Expenses</th><th className="font-normal">Operating</th><th className="font-normal">Result</th></tr>
        </thead>
        <tbody>
          {[...months].reverse().map((x) => (
            <tr key={x.month} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5 text-left">{monthName(x.month, "short")}</td>
              <td>{pct(x.occupancy)}</td><td>{m(x.adr)}</td><td>{x.sold}/{x.available}</td>
              <td>{m(x.income)}</td><td>{m(x.expenses)}</td>
              <td className={x.operating < 0 ? "text-amber-700 dark:text-amber-300" : ""}>{m(x.operating)}</td>
              <td className={x.result < 0 ? "text-amber-700 dark:text-amber-300" : ""}>{m(x.result)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-zinc-500">Operating: the result before costs paid ahead and booked month by month (such as a lease). In {currency}.</p>
    </div>
  );
}
