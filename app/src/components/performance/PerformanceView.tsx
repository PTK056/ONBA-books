"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { acceptAction, dismissAction, writeReport } from "@/app/(app)/performance/actions";
import { money as fmt } from "@/components/overview/format";
import type { Facts, Goal, GoalPath } from "@/lib/performance/metrics";
import type { ReportView } from "@/lib/performance/render";
import { Figures } from "./Figures";
import { GoalPanel } from "./GoalPanel";
import { Blocks, Goals, type BlockRow } from "./Settings";
import { day, good, monthName, neutral, primary, secondary, useAction } from "./ui";

interface Props {
  month: string;
  months: string[];
  closed: boolean;
  report: { status: string; error: string | null; updatedAt: string } | null;
  view: ReportView | null;
  facts: Facts;
  done: Record<string, boolean>;
  /** By goal id. */
  paths: Record<string, GoalPath>;
  goals: Goal[];
  blocks: BlockRow[];
  villas: { id: string; name: string }[];
  places: { id: string; name: string }[];
  firstEntry: string;
  today: string;
}

/**
 * The Performance tab, in the order it is read: the verdict (the month, then the goal as needed against made),
 * what to do, the four figures, the next 60 days, then the detail and the settings folded away.
 */
export function PerformanceView(p: Props) {
  const f = p.facts;
  const analysis = p.view?.analysis ?? null;
  const fees = f.prepaid.length ? f.prepaid.join(", ") : null;
  const [settings, setSettings] = useState(p.goals.length === 0);

  return (
    <div className="flex flex-col gap-6">
      <MonthNav {...p} />

      {(analysis || f.goals.length > 0) ? (
        <section className="card flex flex-col gap-5 p-6">
          {analysis && <p className="text-lg font-semibold leading-snug sm:text-xl">{analysis.headline}</p>}
          {f.goals.length > 0 && <GoalPanel f={f} paths={p.paths} places={p.places} fees={fees} />}
        </section>
      ) : (
        <section className="card flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
          <span>Set a goal (for example, break even by a date) and Sply tells you each month what it takes.</span>
          <button className={primary} onClick={() => { setSettings(true); document.getElementById("settings")?.scrollIntoView({ behavior: "smooth" }); }}>Set a goal</button>
        </section>
      )}

      {p.view && p.view.actions.length > 0 && <Actions view={p.view} done={p.done} currency={f.currency} />}

      <Figures f={f} fees={fees} />

      <Calendar f={f} />

      <Detail f={f} analysis={analysis} />

      <details id="settings" className="card p-5" open={settings} onToggle={(e) => setSettings(e.currentTarget.open)}>
        <summary className="cursor-pointer select-none font-semibold">Settings: goals and blocked nights</summary>
        <div className="mt-4 flex flex-col gap-6">
          <Goals goals={p.goals} places={p.places} firstEntry={p.firstEntry} currency={f.currency} />
          <Blocks blocks={p.blocks} villas={p.villas} today={p.today} />
        </div>
      </details>
    </div>
  );
}

/** Which month (‹ ›), whether its report is written, and the button to write it. */
function MonthNav(p: Props) {
  const router = useRouter();
  const write = useAction();
  const i = p.months.indexOf(p.month);
  const go = (m: string | undefined) => m && router.push(`/performance?month=${m.slice(0, 7)}`);
  const older = p.months[i + 1], newer = p.months[i - 1];
  const nav = "flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 text-lg hover:bg-zinc-50 disabled:opacity-30 dark:border-zinc-700 dark:hover:bg-zinc-900";
  const state = !p.closed ? { text: "Live, not closed yet", tone: neutral }
    : p.report?.status === "ready" ? { text: `Report of ${day(p.report.updatedAt.slice(0, 10))}`, tone: good }
    : p.report?.status === "running" ? { text: "Being written…", tone: neutral }
    : p.report?.status === "failed" ? { text: "Report failed", tone: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200" }
    : { text: "Closed, no report yet", tone: neutral };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className={nav} disabled={!older} onClick={() => go(older)} aria-label="Month before">‹</button>
      <label className="relative">
        <span className="sr-only">Month</span>
        <select className="h-9 cursor-pointer appearance-none rounded-lg bg-transparent px-2 text-lg font-semibold outline-none hover:bg-zinc-100 dark:hover:bg-zinc-900"
          value={p.month.slice(0, 7)} onChange={(e) => go(e.target.value)}>
          {p.months.map((x) => <option key={x} value={x.slice(0, 7)}>{monthName(x)}</option>)}
        </select>
      </label>
      <button className={nav} disabled={!newer} onClick={() => go(newer)} aria-label="Month after">›</button>
      <span className={`ml-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${state.tone}`}
        title={p.report?.status === "failed" ? p.report.error ?? undefined : !p.closed ? "Figures can still change until the month is closed." : undefined}>
        {state.text}
      </span>
      <span className="flex-1" />
      {p.report?.status === "running" && <button className={secondary} onClick={() => router.refresh()}>Refresh</button>}
      {p.closed && p.report?.status !== "running" && (
        <button className={p.report?.status === "ready" ? secondary : primary} disabled={write.pending}
          onClick={() => write.run(() => writeReport(p.month), () => router.refresh())}>
          {write.pending ? "Writing… (about a minute)" : p.report?.status === "ready" ? "Rewrite" : "Write the report"}
        </button>
      )}
      {(write.error || (p.report?.status === "failed" && p.report.error)) && (
        <p className="w-full text-sm text-red-600">{write.error ?? p.report?.error}</p>
      )}
    </div>
  );
}

function Actions({ view, done, currency }: { view: ReportView; done: Record<string, boolean>; currency: string }) {
  const router = useRouter();
  const act = useAction();
  const open = view.actions.filter((a) => a.status !== "dismissed");
  const total = open.reduce((s, a) => s + Math.max(0, a.impact ?? 0), 0);
  const prev = view.last && view.last.total > 0 ? `Last month: ${view.last.done} of ${view.last.total} done.` : null;
  return (
    <section className="card flex flex-col p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">What to do this month</h2>
        {total > 0 && <span className="text-sm text-zinc-500">up to <b className="text-brand-700 dark:text-brand-300">+{fmt(total, currency, true)} {currency}</b> a month</span>}
      </div>
      {(prev || view.analysis?.previous) && (
        <p className="mb-1 text-xs text-zinc-500">{[prev, view.analysis?.previous].filter(Boolean).join(" ")}</p>
      )}
      {view.actions.map((a) => (
        <div key={a.id} className={`flex flex-col gap-3 border-t border-zinc-100 py-4 first-of-type:border-t-0 sm:flex-row sm:items-center dark:border-zinc-800 ${a.status === "dismissed" ? "opacity-50" : ""}`}>
          <span className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white sm:flex">{a.position}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="font-semibold leading-snug">{a.title}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">{a.why}</p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
              {a.impact !== null && (
                <span className="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700 dark:bg-brand-900/60 dark:text-brand-200" title={a.impactNote ?? undefined}>
                  ≈ {a.impact >= 0 ? "+" : ""}{fmt(a.impact, currency, true)} {currency}/month
                </span>
              )}
              <span>{a.effort} effort</span>
              {a.dueOn && <span>by {day(a.dueOn)}</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {a.status === "proposed" ? (
              <>
                <button className={primary} disabled={act.pending} onClick={() => act.run(() => acceptAction(a.id), () => router.refresh())}>Add to my tasks</button>
                <button className={secondary} disabled={act.pending} onClick={() => act.run(() => dismissAction(a.id), () => router.refresh())} aria-label="Not now">Not now</button>
              </>
            ) : (
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${a.status === "dismissed" ? neutral : good}`}>
                {a.status === "dismissed" ? "Set aside" : done[a.id] ? "Done ✓" : "In your tasks"}
              </span>
            )}
          </div>
        </div>
      ))}
      {act.error && <p className="text-sm text-red-600">{act.error}</p>}
    </section>
  );
}

/** The next 60 days, one strip per villa; the biggest free stretch said in words; hover reads a day. */
function Calendar({ f }: { f: Facts }) {
  const c = f.calendar;
  const [hover, setHover] = useState<string | null>(null);
  if (!c.strip.length) return null;
  const color = { b: "bg-brand-600", x: "bg-zinc-400 dark:bg-zinc-500", ".": "bg-zinc-200 dark:bg-zinc-700" } as Record<string, string>;
  const dateAt = (i: number) => new Date(Date.parse(`${c.from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
  const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const biggest = [...c.gaps].sort((a, b) => b.nights - a.nights)[0];
  const pct = c.available ? Math.round((c.booked / c.available) * 100) : null;
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Next {c.days} days{pct !== null && <span className="font-normal text-zinc-500"> · {pct}% booked</span>}</h2>
        {c.lastYearOccupancy !== null && <p className="text-xs text-zinc-500">same days last year: {(c.lastYearOccupancy * 100).toFixed(0)}%</p>}
      </div>
      {biggest && biggest.nights >= 3 && (
        <p className="text-sm">
          Biggest gap: <b>{short(biggest.start)} → {short(biggest.end)}</b>, {biggest.nights} free nights{c.strip.length > 1 ? ` at ${biggest.villa}` : ""}
          {c.orphanNights > 0 && <span className="text-zinc-500"> · {c.orphanNights} nights lost in gaps of 1–2</span>}
        </p>
      )}
      {c.strip.map((s) => (
        <div key={s.villa} className="flex flex-col gap-1">
          {c.strip.length > 1 && <span className="text-xs text-zinc-500">{s.villa}</span>}
          <div className="flex gap-[2px]" aria-label={`${s.villa}: next ${c.days} days`} onPointerLeave={() => setHover(null)}>
            {[...s.days].map((d, i) => {
              const date = dateAt(i);
              const orphan = d === "." && c.gaps.some((g) => g.villa === s.villa && g.orphan && g.start <= date && date < g.end);
              const what = d === "b" ? "booked" : d === "x" ? "blocked" : orphan ? "free, gap too short to sell" : "free";
              return <span key={i} title={`${short(date)}: ${what}`} onPointerEnter={() => setHover(`${s.villa}|${date}|${what}`)}
                className={`h-7 flex-1 rounded-[3px] transition-transform hover:scale-y-110 ${orphan ? "bg-amber-300 dark:bg-amber-700" : color[d]}`} />;
            })}
          </div>
        </div>
      ))}
      <div className="flex text-[10px] text-zinc-500">
        {Array.from({ length: Math.ceil(c.days / 7) }, (_, w) => <span key={w} className="flex-1"><span className={w % 2 ? "hidden sm:inline" : ""}>{short(dateAt(w * 7))}</span></span>)}
      </div>
      <p className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        {hover ? (
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {(() => { const [v, d, w] = hover.split("|"); return `${c.strip.length > 1 ? `${v} · ` : ""}${new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}: ${w}`; })()}
          </span>
        ) : (
          <>
            <Key cls="bg-brand-600" label={`Booked ${c.booked}`} />
            <Key cls="bg-zinc-200 dark:bg-zinc-700" label={`Free ${c.free}`} />
            {c.orphanNights > 0 && <Key cls="bg-amber-300 dark:bg-amber-700" label="Gap of 1–2 nights" />}
            {c.blocked > 0 && <Key cls="bg-zinc-400 dark:bg-zinc-500" label={`Blocked ${c.blocked}`} />}
          </>
        )}
      </p>
    </section>
  );
}

const Key = ({ cls, label }: { cls: string; label: string }) => (
  <span className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${cls}`} />{label}</span>
);

/** What Sply noticed, in tabs: to watch, went well, unusual expenses. */
function Detail({ f, analysis }: { f: Facts; analysis: ReportView["analysis"] }) {
  const cur = f.currency;
  const tabs = [
    { id: "watch", label: "To watch", n: analysis?.issues.length ?? 0, dot: "bg-amber-500" },
    { id: "well", label: "Went well", n: analysis?.wins.length ?? 0, dot: "bg-brand-500" },
    { id: "expenses", label: "Unusual expenses", n: f.anomalies.length, dot: "bg-zinc-400" },
  ].filter((t) => t.n > 0);
  const [tab, setTab] = useState(tabs[0]?.id);
  if (!tabs.length && !f.missing.length) return null;
  const current = tabs.find((t) => t.id === tab) ? tab : tabs[0]?.id;
  return (
    <section className="card flex flex-col gap-3 p-5">
      {tabs.length > 0 && (
        <div role="tablist" className="flex flex-wrap gap-1 border-b border-zinc-100 dark:border-zinc-800">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === current} onClick={() => setTab(t.id)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${t.id === current ? "border-brand-600 font-semibold" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
              <span className={`h-2 w-2 rounded-full ${t.dot}`} aria-hidden />{t.label}
              <span className="rounded-full bg-zinc-100 px-1.5 text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t.n}</span>
            </button>
          ))}
        </div>
      )}
      {current === "watch" && analysis && <Bullets items={analysis.issues} />}
      {current === "well" && analysis && <Bullets items={analysis.wins} />}
      {current === "expenses" && (
        <ul className="flex flex-col gap-2 text-sm">
          {f.anomalies.map((a) => (
            <li key={a.category} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span>{a.category}</span>
              <span className="tabular-nums"><b>{fmt(a.amount, cur, true)}</b> <span className="text-zinc-500">vs {fmt(a.average, cur, true)} usual {a.ratio ? `(×${a.ratio.toFixed(1)})` : "(new)"}</span></span>
            </li>
          ))}
        </ul>
      )}
      {f.missing.length > 0 && <p className="text-xs text-zinc-500">ⓘ {f.missing.join(" ")}</p>}
    </section>
  );
}

const Bullets = ({ items }: { items: { text: string }[] }) => (
  <ul className="flex flex-col gap-2 text-sm leading-relaxed">{items.map((x) => <li key={x.text} className="flex gap-2"><span className="text-zinc-400">–</span>{x.text}</li>)}</ul>
);
