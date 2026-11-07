import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

/** Month | Year | All time, the same on every overview; Performance (the analysis of closed months) for admins. */
export function PeriodSwitch({ view, year, performance = false }: {
  view: "month" | "year" | "all" | "performance"; /** Without one, the year view opens on the latest year. */ year?: string; performance?: boolean;
}) {
  const tabs = [
    { key: "month", label: "Month", href: "/overview" },
    { key: "year", label: "Year", href: year ? `/overview?view=year&year=${year}` : "/overview?view=year" },
    { key: "all", label: "All time", href: "/overview?view=all" },
    ...(performance ? [{ key: "performance", label: "Performance", href: "/performance" }] : []),
  ];
  return (
    <nav className="inline-flex h-9 items-center rounded-lg bg-zinc-200/60 p-0.5 text-sm dark:bg-zinc-800" aria-label="Period">
      {tabs.map((t) => (
        <Link
          key={t.key} href={t.href} aria-current={view === t.key ? "page" : undefined}
          className="rounded-md px-3 py-1 text-zinc-600 aria-[current=page]:bg-white aria-[current=page]:font-medium aria-[current=page]:text-zinc-900 aria-[current=page]:shadow-sm dark:text-zinc-400 dark:aria-[current=page]:bg-zinc-950 dark:aria-[current=page]:text-zinc-100"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function YearNav({ year, years }: { year: string; years: string[] }) {
  const i = years.indexOf(year);
  const newer = i > 0 ? years[i - 1] : null;
  const older = i >= 0 && i < years.length - 1 ? years[i + 1] : null;
  const btn = "flex h-9 w-9 items-center justify-center text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";
  const off = "flex h-9 w-9 items-center justify-center text-zinc-300 dark:text-zinc-700";
  return (
    <div className="card flex items-center overflow-hidden">
      {older ? <Link href={`/overview?view=year&year=${older}`} aria-label="Previous year" className={btn}><ChevronLeft size={16} /></Link> : <span className={off}><ChevronLeft size={16} /></span>}
      <span className="min-w-20 border-x border-zinc-100 px-3 text-center text-sm font-medium dark:border-zinc-800">{year}</span>
      {newer ? <Link href={`/overview?view=year&year=${newer}`} aria-label="Next year" className={btn}><ChevronRight size={16} /></Link> : <span className={off}><ChevronRight size={16} /></span>}
    </div>
  );
}
