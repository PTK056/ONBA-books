import type { CategoryLine } from "@/lib/overview/data";
import { money } from "./format";
import "./chart.css";

const ABOVE_AVERAGE = 1.2; // flag a category 20% above its usual month

/** Expenses of the month by category: amount, share, and how it compares with a usual month. */
export function CategoryBars({ categories, currency }: { categories: CategoryLine[]; currency: string }) {
  if (!categories.length) return <p className="text-sm text-zinc-500">No expenses booked this month.</p>;
  const max = categories[0].amount;
  return (
    <ul className="viz-root flex flex-col gap-3">
      {categories.map((c) => {
        const vsAverage = c.monthlyAverage ? c.amount / c.monthlyAverage : null;
        return (
          <li key={c.name} title={`${c.name}: ${money(c.amount, currency)} ${currency} · ${c.count} entr${c.count === 1 ? "y" : "ies"}`}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">
                {c.name}
                <span className="ml-1.5 text-xs text-zinc-500">{Math.round(c.share * 100)}%</span>
              </span>
              <span className="shrink-0 tabular-nums">{money(c.amount, currency)}</span>
            </div>
            <div className="h-2 rounded-r" style={{ width: `${Math.max(2, (c.amount / max) * 100)}%`, background: "var(--series-expenses)" }} />
            {vsAverage !== null && vsAverage >= ABOVE_AVERAGE && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                ▲ {Math.round((vsAverage - 1) * 100)}% above a usual month ({money(c.monthlyAverage, currency)})
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
