"use client";

import { useState } from "react";
import type { MonthOccupancy } from "@/lib/overview/data";
import { money, monthLabel } from "./format";
import "./chart.css";

const TICKS = [0, 0.25, 0.5, 0.75, 1];

/** Occupancy per month on a fixed 0–100% axis; nightly rate and RevPAR in the tooltip and table. */
export function OccupancyChart({ months, currency, selected, byYear = false }: { months: MonthOccupancy[]; currency: string; selected: string; byYear?: boolean }) {
  const label = (m: string, style: "long" | "short") => (byYear ? m.slice(0, 4) : monthLabel(m, style));
  const [hover, setHover] = useState<number | null>(null);
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <figure className="viz-root @container">
      <div className="flex">
        <div className="relative h-40 w-10 shrink-0">
          {TICKS.map((t) => (
            <span key={t} className="absolute right-1.5 translate-y-1/2 text-[10px] tabular-nums text-zinc-500" style={{ bottom: `${t * 100}%` }}>
              {pct(t)}
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1">
          {months.map((m, i) => (
            <div key={m.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="flex min-w-0 flex-1 flex-col">
              <div className={`relative flex h-40 items-end justify-center px-1 ${hover === i ? "bg-zinc-100 dark:bg-zinc-900" : ""}`}>
                {TICKS.map((t) => (
                  <div key={t} className="pointer-events-none absolute inset-x-0 border-t" style={{ bottom: `${t * 100}%`, borderColor: "var(--grid)" }} />
                ))}
                <div
                  className="relative w-full max-w-6 rounded-t"
                  style={{ height: `${m.occupancy * 100}%`, background: "var(--series-occupancy)", minHeight: m.booked ? 2 : 0 }}
                />
                {hover === i && (
                  <div
                    role="tooltip"
                    className={`absolute bottom-full z-10 mb-1 w-max rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${i >= months.length / 2 ? "right-0" : "left-0"}`}
                  >
                    <p className="mb-1 font-medium">{label(m.month, "long")}</p>
                    <Row k="Occupancy" v={`${pct(m.occupancy)} · ${m.booked} of ${m.available} nights`} />
                    <Row k="Nightly rate" v={m.adr === null ? "—" : `${money(m.adr, currency)} ${currency}`} />
                    <Row k="RevPAR" v={`${money(m.revpar, currency)} ${currency}`} />
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
            <tr>
              <th className="font-normal">Month</th><th className="text-right font-normal">Nights</th>
              <th className="text-right font-normal">Occupancy</th><th className="text-right font-normal">Nightly rate</th>
              <th className="text-right font-normal">RevPAR</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="py-1">{label(m.month, "long")}</td>
                <td className="text-right">{m.booked}/{m.available}</td>
                <td className="text-right">{pct(m.occupancy)}</td>
                <td className="text-right">{m.adr === null ? "—" : money(m.adr, currency)}</td>
                <td className="text-right">{money(m.revpar, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <p className="flex gap-3 tabular-nums"><span className="text-zinc-500">{k}</span><span className="ml-auto">{v}</span></p>;
}
