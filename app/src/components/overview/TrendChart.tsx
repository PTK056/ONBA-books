"use client";

import { useState } from "react";
import type { MonthTotals } from "@/lib/overview/data";
import { money, monthLabel } from "./format";
import "./chart.css";

const SERIES = [
  { key: "income", label: "Income", color: "var(--series-income)" },
  { key: "expenses", label: "Expenses", color: "var(--series-expenses)" },
] as const;

/** Income and expenses per month, grouped bars on one axis, with a hover tooltip and a table view. */
export function TrendChart({ trend, currency, selected, byYear = false }: { trend: MonthTotals[]; currency: string; selected: string; byYear?: boolean }) {
  const label = (m: string, style: "long" | "short") => (byYear ? m.slice(0, 4) : monthLabel(m, style));
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...trend.flatMap((t) => [t.income, t.expenses]));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];

  return (
    <figure className="viz-root @container">
      <div className="mb-3 flex items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="ml-auto">{currency}</span>
      </div>

      <div className="flex">
        {/* Y axis labels, aligned with the gridlines of the plot area */}
        <div className="relative h-48 w-10 shrink-0">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-1.5 translate-y-1/2 text-[10px] tabular-nums text-zinc-500"
              style={{ bottom: `${(t / top) * 100}%` }}
            >
              {money(t, currency, true)}
            </span>
          ))}
        </div>

        <div className="flex min-w-0 flex-1">
          {trend.map((m, i) => (
            <div
              key={m.month}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className="flex min-w-0 flex-1 flex-col"
            >
              <div className={`relative flex h-48 items-end justify-center gap-0.5 px-0.5 ${hover === i ? "bg-zinc-100 dark:bg-zinc-900" : ""}`}>
                {/* Gridlines, drawn per column so they line up with the axis labels */}
                {ticks.map((t) => (
                  <div key={t} className="pointer-events-none absolute inset-x-0 border-t" style={{ bottom: `${(t / top) * 100}%`, borderColor: "var(--grid)" }} />
                ))}
                {SERIES.map((s) => (
                  <div
                    key={s.key}
                    className="relative w-full max-w-4 rounded-t"
                    style={{ height: `${(m[s.key] / top) * 100}%`, background: s.color, minHeight: m[s.key] > 0 ? 2 : 0 }}
                  />
                ))}
                {hover === i && (
                  <div
                    role="tooltip"
                    className={`absolute bottom-full z-10 mb-1 w-max rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${
                      i >= trend.length / 2 ? "right-0" : "left-0"
                    }`}
                  >
                    <p className="mb-1 font-medium">{label(m.month, "long")}</p>
                    {SERIES.map((s) => (
                      <p key={s.key} className="flex items-center gap-1.5 tabular-nums">
                        <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                        {s.label} <span className="ml-auto pl-3">{money(m[s.key], currency)}</span>
                      </p>
                    ))}
                    <p className="mt-1 flex border-t border-zinc-200 pt-1 tabular-nums dark:border-zinc-800">
                      Net <span className="ml-auto pl-3">{money(m.net, currency)}</span>
                    </p>
                  </div>
                )}
              </div>
              <span className={`mt-1 text-center text-[10px] ${m.month === selected ? "font-semibold text-zinc-900 dark:text-zinc-100" : "text-zinc-500"}`}>
                <span className="@md:hidden">{byYear ? label(m.month, "short") : label(m.month, "short").charAt(0)}</span>
                <span className="hidden @md:inline">{label(m.month, "short")}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-zinc-500">Show as table</summary>
        <table className="mt-2 w-full tabular-nums">
          <thead className="text-left text-zinc-500">
            <tr><th className="font-normal">Month</th><th className="text-right font-normal">Income</th><th className="text-right font-normal">Expenses</th><th className="text-right font-normal">Net</th></tr>
          </thead>
          <tbody>
            {trend.map((m) => (
              <tr key={m.month} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="py-1">{label(m.month, "long")}</td>
                <td className="text-right">{money(m.income, currency)}</td>
                <td className="text-right">{money(m.expenses, currency)}</td>
                <td className="text-right">{money(m.net, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** 3–5 round gridline values from 0 to at least `max`. */
function niceTicks(max: number): number[] {
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough)!;
  const ticks = [];
  for (let v = 0; v < max + step; v += step) ticks.push(v);
  return ticks;
}
