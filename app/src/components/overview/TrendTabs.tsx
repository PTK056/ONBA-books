"use client";

import { useState } from "react";
import type { MonthOccupancy, MonthTotals } from "@/lib/overview/data";
import { OccupancyChart } from "./OccupancyChart";
import { TrendChart } from "./TrendChart";

/** One 12-month card: money or occupancy. */
export function TrendTabs({ trend, occupancy, currency, selected, hasStays, title = "Last 12 months", byYear = false }: {
  trend: MonthTotals[]; occupancy: MonthOccupancy[]; currency: string; selected: string; hasStays: boolean;
  title?: string; byYear?: boolean;
}) {
  const [tab, setTab] = useState<"money" | "occupancy">("money");
  return (
    <section className="card p-5">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hasStays && (
          <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 text-xs dark:bg-zinc-800" role="tablist">
            {(["money", "occupancy"] as const).map((t) => (
              <button
                key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 ${tab === t ? "bg-white font-medium shadow-sm dark:bg-zinc-900" : "text-zinc-500"}`}
              >
                {t === "money" ? "Income & expenses" : "Occupancy"}
              </button>
            ))}
          </div>
        )}
      </div>
      {tab === "money"
        ? <TrendChart trend={trend} currency={currency} selected={selected} byYear={byYear} />
        : <OccupancyChart months={occupancy} currency={currency} selected={selected} byYear={byYear} />}
    </section>
  );
}
