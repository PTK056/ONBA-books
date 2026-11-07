import { ArrowDownRight, ArrowUpRight, CalendarRange, Moon, Target } from "lucide-react";
import { money as fmt } from "@/components/overview/format";
import { monthEnd } from "@/lib/performance/metrics";
import type { Pulse as PulseData } from "@/lib/performance/pulse";
import { monthName, shortMonth } from "./ui";

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en", { day: "numeric", month: "short", timeZone: "UTC" });
const signed = (n: number, cur: string) => `${n >= 0 ? "+" : "−"}${fmt(Math.abs(n), cur, true)}`;

/**
 * The top of the Performance tab, read at a glance: the month's profit or loss, what came in against what went out,
 * how it compares, what is left to sell, and the one thing to do. Live for the current month.
 */
export function Pulse({ p, currency: cur, action, onSetGoal }: {
  p: PulseData; currency: string; action: string | null; onSetGoal: () => void;
}) {
  const profit = p.result >= 0;
  const max = Math.max(p.income, p.expenses, 1);
  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-zinc-500">
            {monthName(p.month)} · {profit ? "profit" : "loss"}{p.live ? " so far" : ""}
          </p>
          <p className="flex flex-wrap gap-2 text-xs">
            {p.vsLastMonth && <Delta label={`vs ${shortMonth(p.vsLastMonth.month)}`} diff={p.result - p.vsLastMonth.result} cur={cur} />}
            {p.vsLastYear && <Delta label={`vs ${monthName(p.vsLastYear.month, "short")}`} diff={p.result - p.vsLastYear.result} cur={cur} />}
          </p>
        </div>

        <p className={`text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl ${profit ? "text-brand-700 dark:text-brand-300" : "text-rose-600 dark:text-rose-400"}`}>
          {signed(p.result, cur)} <span className="text-base font-normal text-zinc-400">{cur}</span>
        </p>

        {/* In against out: the gap between the two bars is the result. */}
        <div className="viz-root flex flex-col gap-2 text-sm">
          <Bar label="In" note="income" value={p.income} max={max} cur={cur} color="var(--series-income)" />
          <Bar label="Out" note={p.prepaid.amount ? `expenses, of which ${p.prepaid.names.join(", ")} ${fmt(p.prepaid.amount, cur, true)}` : "expenses"}
            value={p.expenses} max={max} cur={cur} color="var(--series-expenses)" />
          {p.margin !== null && <p className="text-xs text-zinc-500">{Math.round(p.margin * 100)}% of the income is left{p.live ? ", nights still to come included" : ""}.</p>}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {p.live && p.nightsLeft !== null
          ? <Tile icon={<CalendarRange size={16} />} label="Left to sell this month" value={`${p.nightsLeft} night${p.nightsLeft === 1 ? "" : "s"}`} note={`until ${day(monthEnd(p.month))}`} />
          : <Tile icon={<CalendarRange size={16} />} label="Occupancy" value={p.occupancy === null ? "—" : `${Math.round(p.occupancy * 100)}%`} note={monthName(p.month)} />}
        <Tile icon={<CalendarRange size={16} />} label="Next 30 days" value={p.next30.share === null ? "—" : `${Math.round(p.next30.share * 100)}% booked`}
          note={`${p.next30.booked} of ${p.next30.available} nights`} />
        <Tile icon={<Moon size={16} />} label="Nightly rate" value={p.nightlyRate.now === null ? "—" : fmt(p.nightlyRate.now, cur, true)}
          note={p.nightlyRate.now !== null && p.nightlyRate.before ? `${p.nightlyRate.now >= p.nightlyRate.before ? "↑" : "↓"} ${Math.abs(Math.round((p.nightlyRate.now / p.nightlyRate.before - 1) * 100))}% vs last month` : "before Airbnb fees"} />
      </section>

      {(action || p.nextGap) && (
        <section className="card flex items-start gap-3 border-brand-200 bg-brand-50/50 p-4 text-sm dark:border-brand-900 dark:bg-brand-950/30">
          <span aria-hidden>👉</span>
          <p>
            <span className="font-medium">One thing to do: </span>
            {action ?? <>sell {day(p.nextGap!.start)} – {day(p.nextGap!.end)} first, {p.nextGap!.nights} free nights in a row{p.nextGap!.villa ? ` at ${p.nextGap!.villa}` : ""}.</>}
          </p>
        </section>
      )}

      {p.goal ? (
        <section className="card flex flex-col gap-2 p-4 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <Target size={15} className="text-brand-600" />
            <span className="font-medium">{p.goal.label}</span>
            <span className="text-zinc-500">by {day(p.goal.byDate)}</span>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${p.goal.onTrack === null ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" : p.goal.onTrack ? "bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100" : "bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100"}`}>
              {p.goal.onTrack === null ? "Not enough history yet" : p.goal.onTrack ? "On track" : "Off track"}
            </span>
          </p>
          {p.goal.progress !== null && (
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className="h-full rounded-full" style={{ width: `${p.goal.progress * 100}%`, background: "var(--series-income)" }} />
            </div>
          )}
          <p className="text-xs text-zinc-500">
            {p.goal.cumulative >= p.goal.target
              ? `${fmt(p.goal.cumulative, cur, true)} ${cur} made: reached`
              : p.goal.target > 0 && p.goal.cumulative > 0
                ? `${fmt(p.goal.cumulative, cur, true)} of ${fmt(p.goal.target, cur, true)} ${cur} so far`
                : `${fmt(p.goal.target - p.goal.cumulative, cur, true)} ${cur} still to make up`}
            {p.goal.requiredPerMonth !== null && p.goal.pace3 !== null && ` · needs ${fmt(p.goal.requiredPerMonth, cur, true)} a month, the last 3 months made ${fmt(p.goal.pace3, cur, true)}`}
          </p>
        </section>
      ) : (
        <button className="self-start text-sm text-brand-700 hover:underline dark:text-brand-400" onClick={onSetGoal}>
          + Set a goal (break even, pay back the works by a date): Sply tells you each month what it takes
        </button>
      )}
    </div>
  );
}

function Delta({ label, diff, cur }: { label: string; diff: number; cur: string }) {
  const up = diff >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium ${up ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300" : "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300"}`}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{signed(diff, cur)} {label}
    </span>
  );
}

function Bar({ label, note, value, max, cur, color }: { label: string; note: string; value: number; max: number; cur: string; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span><span className="font-medium">{label}</span> <span className="text-xs text-zinc-500">{note}</span></span>
        <span className="tabular-nums">{fmt(value, cur)}</span>
      </div>
      <div className="h-2.5 rounded-r" style={{ width: `${Math.max(2, (value / max) * 100)}%`, background: color }} />
    </div>
  );
}

function Tile({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return (
    <div className="card p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500"><span className="text-brand-600 dark:text-brand-400">{icon}</span>{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-zinc-500">{note}</p>
    </div>
  );
}
