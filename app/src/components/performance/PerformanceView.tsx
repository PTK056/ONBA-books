"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptAction, addBlock, archiveGoal, deleteBlock, dismissAction, saveGoal, writeReport, type GoalInput, type Result } from "@/app/(app)/performance/actions";
import { money as fmt } from "@/components/overview/format";
import { show } from "@/lib/performance/analyze";
import type { Facts, Goal, GoalPath, MonthFigures } from "@/lib/performance/metrics";
import type { ReportView } from "@/lib/performance/render";
import "@/components/overview/chart.css";

const field = "h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-brand-600 dark:border-zinc-700 dark:bg-zinc-900";
const primary = "h-9 rounded-lg bg-brand-600 px-3 btn-label shadow-sm hover:bg-brand-700 disabled:opacity-50";
const secondary = "h-9 rounded-lg border border-zinc-300 px-3 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

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
  blocks: { id: string; villaId: string; start: string; end: string; reason: string; note: string | null }[];
  villas: { id: string; name: string }[];
  places: { id: string; name: string }[];
  firstEntry: string;
  today: string;
}

const monthName = (m: string, style: "long" | "short" = "long") =>
  new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en", { month: style, year: "numeric", timeZone: "UTC" });
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>, after?: () => void) => start(async () => {
    setError(null);
    const r = await fn();
    if (!r.ok) setError(r.error);
    else after?.();
  });
  return { pending, error, run };
}

export function PerformanceView(p: Props) {
  const router = useRouter();
  const f = p.facts;
  const cur = f.currency;
  const write = useAction();
  const analysis = p.view?.analysis ?? null;
  const main = f.goals.find((g) => !g.over) ?? f.goals[0];
  const fees = f.prepaid.length ? f.prepaid.join(", ") : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Which month, and whether its report is written */}
      <div className="flex flex-wrap items-center gap-3">
        <select className={field} value={p.month.slice(0, 7)} aria-label="Month"
          onChange={(e) => router.push(`/performance?month=${e.target.value}`)}>
          {p.months.map((x) => <option key={x} value={x.slice(0, 7)}>{monthName(x)}</option>)}
        </select>
        <span className="flex-1 text-sm text-zinc-500">
          {!p.closed ? "Not closed yet: live figures that can still change."
            : p.report?.status === "ready" ? `Report of ${day(p.report.updatedAt.slice(0, 10))}`
            : p.report?.status === "running" ? "Being written: refresh in a minute."
            : p.report?.status === "failed" ? p.report.error ?? "The report could not be written."
            : "Closed, no report yet."}
        </span>
        {p.closed && p.report?.status !== "running" && (
          <button className={p.report?.status === "ready" ? secondary : primary} disabled={write.pending}
            onClick={() => write.run(() => writeReport(p.month), () => router.refresh())}>
            {write.pending ? "Writing… (about a minute)" : p.report?.status === "ready" ? "Rewrite" : "Write the report"}
          </button>
        )}
        {write.error && <p className="w-full text-sm text-red-600">{write.error}</p>}
      </div>

      {/* The verdict: the month in one sentence, and the main goal as "needed" against "doing" */}
      <section className="card flex flex-col gap-5 p-6">
        {analysis && <p className="text-xl font-semibold leading-snug sm:text-2xl">{analysis.headline}</p>}
        {main && <GoalVerdict f={f} goalKey={main.key} label={main.label} byDate={main.byDate} target={main.target} fees={fees} big={!analysis} />}
        {analysis?.goals && <p className="text-sm text-zinc-600 dark:text-zinc-300">{analysis.goals}</p>}
        {main && p.paths[main.id] && <GoalChart path={p.paths[main.id]} currency={cur} />}
        {main && <Counted g={main} f={f} places={p.places} fees={fees} />}
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi f={f} k="occupancy" label="Occupancy" />
        <Kpi f={f} k="adr" label="Rate per night" />
        <Kpi f={f} k="income" label="Income" />
        <Kpi f={f} k="operating" label={fees ? `Result before ${fees}` : "Result"} />
      </section>

      {p.view && p.view.actions.length > 0 && <Actions actions={p.view.actions} done={p.done} currency={cur} />}

      {analysis && (analysis.wins.length > 0 || analysis.issues.length > 0) && (
        <section className="grid gap-3 sm:grid-cols-2">
          <Points title="Went well" tone="good" items={analysis.wins} />
          <Points title="To watch" tone="bad" items={analysis.issues} />
        </section>
      )}

      <Calendar f={f} />

      {f.goals.filter((g) => g.id !== main?.id).map((g) => (
        <section key={g.id} className="card flex flex-col gap-4 p-5">
          <GoalVerdict f={f} goalKey={g.key} label={g.label} byDate={g.byDate} target={g.target} fees={fees} />
          {p.paths[g.id] && <GoalChart path={p.paths[g.id]} currency={cur} />}
          <Counted g={g} f={f} places={p.places} fees={fees} />
        </section>
      ))}

      {(f.anomalies.length > 0 || f.missing.length > 0) && (
        <section className="card flex flex-col gap-3 p-5 text-sm">
          {f.anomalies.length > 0 && (
            <div>
              <h2 className="font-semibold">Unusual expenses</h2>
              <ul className="mt-2 flex flex-col gap-1">
                {f.anomalies.map((a) => (
                  <li key={a.category} className="flex justify-between gap-3">
                    <span>{a.category}</span>
                    <span className="tabular-nums"><b>{fmt(a.amount, cur, true)}</b> <span className="text-zinc-500">vs {fmt(a.average, cur, true)} usual {a.ratio ? `(×${a.ratio.toFixed(1)})` : "(new)"}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {f.missing.length > 0 && <p className="text-xs text-zinc-500">ℹ️ {f.missing.join(" ")}</p>}
        </section>
      )}

      <details className="card p-5">
        <summary className="cursor-pointer select-none font-semibold">Month by month</summary>
        <div className="mt-3"><MonthsTable months={f.months} currency={cur} /></div>
      </details>

      <details className="card p-5">
        <summary className="cursor-pointer select-none font-semibold">Settings: goals and blocked nights</summary>
        <div className="mt-4 flex flex-col gap-6">
          <Goals goals={p.goals} places={p.places} firstEntry={p.firstEntry} currency={cur} />
          <Blocks blocks={p.blocks} villas={p.villas} today={p.today} />
        </div>
      </details>
    </div>
  );
}

/** How a goal's figures are made, folded away. */
function Counted({ g, f, places, fees }: { g: Facts["goals"][number]; f: Facts; places: { id: string; name: string }[]; fees: string | null }) {
  const cur = f.currency;
  return (
    <details className="text-xs text-zinc-500">
      <summary className="cursor-pointer select-none">How it is counted</summary>
      <ul className="mt-2 list-disc pl-5 leading-relaxed">
        <li>Every validated entry since {day(g.since)}, {g.placeId ? places.find((x) => x.id === g.placeId)?.name ?? "the villa" : "villas and company"}: {fmt(g.cumulative, cur, true)} {cur} so far.</li>
        {g.committed > 0 && <li>Already committed before {day(g.byDate)} ({fees ?? "costs paid ahead"}): {fmt(g.committed, cur, true)} {cur}.</li>}
        {g.bookedNet > 0 && <li>Stays already booked before then, net: {fmt(g.bookedNet, cur, true)} {cur}.</li>}
        {g.planned > 0 && <li>Planned, not in the books yet: {fmt(g.planned, cur, true)} {cur}{g.plannedNote ? ` (${g.plannedNote})` : ""}.</li>}
        <li>The dashed line: the months left as the same months of the latest year, less what is committed and planned.</li>
        {g.roi !== null && <li>Return on the {fmt(g.invested ?? 0, cur, true)} {cur} invested so far: {(g.roi * 100).toFixed(1)}%.</li>}
      </ul>
    </details>
  );
}

const good = "bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100";
const bad = "bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100";

/** A goal at a glance: where it lands, and what each month must make against what the last months made. */
function GoalVerdict({ f, goalKey, label, byDate, target, fees, big = false }: { f: Facts; goalKey: string; label: string; byDate: string; target: number; fees: string | null; big?: boolean }) {
  const cur = f.currency;
  const m = (k: string) => f.metrics[`${goalKey}.${k}`]?.value ?? null;
  const need = m("required_per_month"), pace = m("pace3"), proj = m("projected") ?? m("projected_at_pace");
  const g = f.goals.find((x) => x.key === goalKey);
  const status = g?.over ? (g.reached ? { text: "Reached", tone: good } : { text: "Not reached", tone: bad })
    : proj === null ? { text: "Not enough history yet", tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" }
    : proj >= target ? { text: "On track", tone: good } : { text: `${fmt(target - proj, cur, true)} ${cur} short`, tone: bad };
  const max = Math.max(need ?? 0, pace ?? 0, 1);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={big ? "text-xl font-semibold" : "font-semibold"}>🎯 {label} <span className="font-normal text-zinc-500">· {day(byDate)}</span></h2>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${status.tone}`}>{status.text}</span>
      </div>
      {need !== null && pace !== null && !g?.over && (
        <div className="flex flex-col gap-2">
          <Bar label={`Needed each month${fees ? ` (before ${fees})` : ""}`} value={need} max={max} cur={cur} color="var(--series-expenses)" />
          <Bar label="Made per month, last 3 months" value={pace} max={max} cur={cur} color="var(--series-income)" />
          <p className="text-sm">
            {pace >= need ? <>Ahead by <b>{fmt(pace - need, cur, true)} {cur}</b> a month.</>
              : <>Short by <b className="text-amber-700 dark:text-amber-300">{fmt(need - pace, cur, true)} {cur}</b> a month, for {g?.monthsLeft} months.</>}
            {proj !== null && <span className="text-zinc-500"> At this rate: {fmt(proj, cur, true)} {cur} on {day(byDate)}.</span>}
          </p>
        </div>
      )}
    </div>
  );
}

function Bar({ label, value, max, cur, color }: { label: string; value: number; max: number; cur: string; color: string }) {
  return (
    <div className="viz-root grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[16rem_minmax(0,1fr)_6rem]">
      <span className="text-zinc-600 dark:text-zinc-300">{label}</span>
      <span className="order-3 col-span-2 h-3 overflow-hidden rounded-full bg-zinc-100 sm:order-none sm:col-span-1 dark:bg-zinc-800">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (Math.max(0, value) / max) * 100)}%`, background: color }} />
      </span>
      <span className="text-right font-semibold tabular-nums">{fmt(value, cur, true)}</span>
    </div>
  );
}

/** One figure, big, with how it moved against the same month last year (or the 3 months before). */
function Kpi({ f, k, label }: { f: Facts; k: string; label: string }) {
  const v = f.metrics[`month.${k}`], ly = f.metrics[`last_year.${k}`], p3 = f.metrics[`prev3.${k}`];
  const ref = ly ?? p3;
  let delta: { text: string; up: boolean } | null = null;
  if (v?.value !== null && v && ref?.value !== null && ref) {
    if (v.unit === "percent") delta = { text: `${((v.value - ref.value) * 100).toFixed(0)} pts`, up: v.value >= ref.value };
    else if (ref.value !== 0) delta = { text: `${(((v.value - ref.value) / Math.abs(ref.value)) * 100).toFixed(0)}%`, up: v.value >= ref.value };
  }
  return (
    <div className="card flex flex-col gap-1 p-4">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{v ? show(v, f.currency).replace(` ${f.currency}`, "") : "—"}</p>
      {delta && ref ? (
        <p className="flex items-center gap-1.5 text-xs">
          <span className={`rounded-full px-1.5 py-0.5 font-semibold ${delta.up ? good : bad}`}>{delta.up ? "▲" : "▼"} {delta.text.replace("-", "")}</span>
          <span className="text-zinc-500">vs {show(ref, f.currency).replace(` ${f.currency}`, "")} {ly ? "last year" : "before"}</span>
        </p>
      ) : <p className="text-xs text-zinc-500">&nbsp;</p>}
    </div>
  );
}

function Points({ title, items, tone }: { title: string; items: { text: string }[]; tone: "good" | "bad" }) {
  if (!items.length) return <div />;
  return (
    <div className="card p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <span className={`h-2 w-2 rounded-full ${tone === "good" ? "bg-brand-500" : "bg-amber-500"}`} />{title}
      </h2>
      <ul className="mt-3 flex flex-col gap-2 text-sm leading-relaxed">{items.map((x) => <li key={x.text}>{x.text}</li>)}</ul>
    </div>
  );
}

function Actions({ actions, done, currency }: { actions: ReportView["actions"]; done: Record<string, boolean>; currency: string }) {
  const router = useRouter();
  const act = useAction();
  return (
    <section className="card flex flex-col gap-1 p-5">
      <h2 className="mb-2 text-lg font-semibold">What to do this month</h2>
      {actions.map((a) => (
        <div key={a.id} className={`flex flex-col gap-3 border-t border-zinc-100 py-4 first-of-type:border-t-0 sm:flex-row sm:items-start dark:border-zinc-800 ${a.status === "dismissed" ? "opacity-50" : ""}`}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{a.position}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="font-semibold leading-snug">{a.title}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">{a.why}</p>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
              {a.impact !== null && <span className="font-semibold text-brand-700 dark:text-brand-300">≈ {a.impact >= 0 ? "+" : ""}{fmt(a.impact, currency, true)} {currency}/month</span>}
              {a.impactNote && <span>{a.impactNote}</span>}
              <span>effort {a.effort}</span>
              {a.dueOn && <span>by {day(a.dueOn)}</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {a.status === "proposed" ? (
              <>
                <button className={primary} disabled={act.pending} onClick={() => act.run(() => acceptAction(a.id), () => router.refresh())}>Add to my tasks</button>
                <button className={secondary} disabled={act.pending} onClick={() => act.run(() => dismissAction(a.id), () => router.refresh())}>Not now</button>
              </>
            ) : (
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${a.status === "dismissed" ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" : good}`}>
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

/** Cumulative result, month by month (solid), where it heads (dashed), against the target. */
function GoalChart({ path, currency }: { path: GoalPath; currency: string }) {
  const pts = [...path.actual, ...path.projection.slice(1)];
  if (pts.length < 2) return null;
  const W = 640, H = 150, L = 8, R = 8, T = 14, B = 20;
  const vals = [...pts.map((x) => x.value), path.target];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.1 || 1;
  const y0 = lo - pad, y1 = hi + pad;
  const x = (i: number) => L + (i / (pts.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const line = (from: number, list: { value: number }[]) => list.map((q, i) => `${i ? "L" : "M"}${x(from + i).toFixed(1)},${y(q.value).toFixed(1)}`).join(" ");
  const n = path.actual.length;
  const now = path.actual[n - 1];
  const end = path.projection.at(-1);
  const years = pts.map((q, i) => ({ i, q })).filter(({ q, i }) => i === 0 || q.month.slice(5, 7) === "01");
  return (
    <figure className="viz-root">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-label="Cumulative result against the goal">
        <line x1={L} x2={W - R} y1={y(path.target)} y2={y(path.target)} stroke="currentColor" strokeOpacity="0.35" strokeDasharray="2 3" />
        <text x={L} y={y(path.target) - 5} fontSize="11" fill="currentColor" opacity="0.6">Target {fmt(path.target, currency, true)}</text>
        <path d={`${line(0, path.actual)} L${x(n - 1)},${y(y0)} L${x(0)},${y(y0)} Z`} fill="var(--series-income)" opacity="0.08" />
        <path d={line(0, path.actual)} fill="none" stroke="var(--series-income)" strokeWidth="2.5" strokeLinejoin="round" />
        {path.projection.length > 1 && <path d={line(n - 1, path.projection)} fill="none" stroke="var(--series-income)" strokeWidth="2" strokeDasharray="5 4" opacity="0.6" />}
        <circle cx={x(n - 1)} cy={y(now.value)} r="4" fill="var(--series-income)" />
        <text x={x(n - 1)} y={y(now.value) - 9} textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor">Now {fmt(now.value, currency, true)}</text>
        {end && path.projection.length > 1 && (
          <text x={W - R} y={y(end.value) + (end.value < now.value ? 16 : -9)} textAnchor="end" fontSize="11" fill="currentColor" opacity="0.75">{fmt(end.value, currency, true)}</text>
        )}
        {years.map(({ i, q }) => (
          <text key={q.month} x={x(i)} y={H - 4} textAnchor={i === 0 ? "start" : "middle"} fontSize="10" fill="currentColor" opacity="0.5">
            {i === 0 ? new Date(`${q.month}T00:00:00Z`).toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" }) : q.month.slice(0, 4)}
          </text>
        ))}
      </svg>
    </figure>
  );
}

function Calendar({ f }: { f: Facts }) {
  const c = f.calendar;
  if (!c.strip.length) return null;
  const color = { b: "bg-brand-600", x: "bg-zinc-400 dark:bg-zinc-500", ".": "bg-zinc-200 dark:bg-zinc-700" } as Record<string, string>;
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Next {c.days} days</h2>
        <p className="text-xs text-zinc-500">
          {c.booked} booked · {c.free} free{c.orphanNights ? ` · ${c.orphanNights} in gaps of 1–2 nights` : ""}{c.blocked ? ` · ${c.blocked} blocked` : ""}
          {c.lastYearOccupancy !== null ? ` · same days last year: ${(c.lastYearOccupancy * 100).toFixed(0)}% full` : ""}
        </p>
      </div>
      {c.strip.map((s) => (
        <div key={s.villa} className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">{s.villa}</span>
          <div className="flex gap-[2px]" aria-label={`${s.villa}: next ${c.days} days`}>
            {[...s.days].map((d, i) => {
              const date = new Date(Date.parse(`${c.from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
              const orphan = d === "." && c.gaps.some((g) => g.villa === s.villa && g.orphan && g.start <= date && date < g.end);
              return <span key={i} title={`${date}: ${d === "b" ? "booked" : d === "x" ? "blocked" : orphan ? "free, gap too short" : "free"}`}
                className={`h-8 flex-1 rounded-[3px] ${orphan ? "bg-amber-300 dark:bg-amber-700" : color[d]}`} />;
            })}
          </div>
        </div>
      ))}
      <div className="flex text-[10px] text-zinc-500">
        {Array.from({ length: Math.ceil(c.days / 7) }, (_, w) => (
          <span key={w} className="flex-1">{new Date(Date.parse(`${c.from}T00:00:00Z`) + w * 7 * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</span>
        ))}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-600" />Booked</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-zinc-200 dark:bg-zinc-700" />Free</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-300 dark:bg-amber-700" />Gap of 1–2 nights</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-zinc-400 dark:bg-zinc-500" />Blocked</span>
      </p>
    </section>
  );
}

function MonthsTable({ months, currency }: { months: MonthFigures[]; currency: string }) {
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(0)}%`);
  const m = (v: number | null) => (v === null ? "—" : fmt(v, currency, true));
  return (
    <section className="overflow-x-auto">
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
      <p className="mt-2 text-xs text-zinc-500">Operating: the result before costs paid ahead and booked month by month (such as a lease). In {currency}.</p>
    </section>
  );
}

function Goals({ goals, places, firstEntry, currency }: { goals: Goal[]; places: { id: string; name: string }[]; firstEntry: string; currency: string }) {
  const [editing, setEditing] = useState<string | "new" | null>(goals.length ? null : "new");
  const act = useAction();
  const router = useRouter();
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Goals</h2>
        {editing === null && <button className={secondary} onClick={() => setEditing("new")}>Add a goal</button>}
      </div>
      <p className="text-sm text-zinc-500">Where you want the cumulative result (income − expenses) to be by a date: 0 to break even.</p>
      {goals.map((g) => editing === g.id
        ? <GoalForm key={g.id} goal={g} places={places} firstEntry={firstEntry} currency={currency} onDone={() => setEditing(null)} />
        : (
          <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800">
            <span><b>{g.label}</b>: {fmt(g.target, currency)} {currency} by {day(g.byDate)}{g.invested ? ` · invested ${fmt(g.invested, currency, true)}` : ""}{g.planned ? ` · planned ${fmt(g.planned, currency, true)}` : ""}</span>
            <span className="flex gap-2">
              <button className={secondary} onClick={() => setEditing(g.id)}>Edit</button>
              <button className={secondary} disabled={act.pending} onClick={() => act.run(() => archiveGoal(g.id), () => router.refresh())}>Remove</button>
            </span>
          </div>
        ))}
      {editing === "new" && <GoalForm places={places} firstEntry={firstEntry} currency={currency} onDone={() => setEditing(null)} />}
      {act.error && <p className="text-sm text-red-600">{act.error}</p>}
    </section>
  );
}

function GoalForm({ goal, places, firstEntry, currency, onDone }: { goal?: Goal; places: { id: string; name: string }[]; firstEntry: string; currency: string; onDone: () => void }) {
  const [g, setG] = useState({
    label: goal?.label ?? "Break even", villaId: goal?.placeId ?? "", since: goal?.since ?? firstEntry, byDate: goal?.byDate ?? "",
    target: String(goal?.target ?? 0), invested: goal?.invested ? String(goal.invested) : "", planned: goal?.planned ? String(goal.planned) : "", plannedNote: goal?.plannedNote ?? "",
  });
  const act = useAction();
  const router = useRouter();
  const set = (k: keyof typeof g) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setG({ ...g, [k]: e.target.value });
  const num = (s: string) => Number(s.replace(/[\s,]/g, ""));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input: GoalInput = {
      id: goal?.id, label: g.label, villaId: g.villaId || null, since: g.since, byDate: g.byDate, target: num(g.target),
      invested: g.invested.trim() ? num(g.invested) : null, planned: g.planned.trim() ? num(g.planned) : 0, plannedNote: g.plannedNote || null,
    };
    act.run(() => saveGoal(input), () => { onDone(); router.refresh(); });
  };
  const label = "flex flex-col gap-1 text-sm font-medium";
  return (
    <form onSubmit={submit} className="grid gap-3 border-t border-zinc-100 pt-3 sm:grid-cols-2 dark:border-zinc-800">
      <label className={label}>Name<input className={field} value={g.label} onChange={set("label")} maxLength={80} /></label>
      <label className={label}>For
        <select className={field} value={g.villaId} onChange={set("villaId")}>
          <option value="">The whole business (villas and company)</option>
          {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className={label}>Counted from<input type="date" className={field} value={g.since} onChange={set("since")} /></label>
      <label className={label}>By<input type="date" className={field} value={g.byDate} onChange={set("byDate")} /></label>
      <label className={label}>Cumulative result to reach ({currency})<input className={field} inputMode="numeric" value={g.target} onChange={set("target")} /></label>
      <label className={label}>Capital invested ({currency}, for the return)<input className={field} inputMode="numeric" value={g.invested} onChange={set("invested")} placeholder="e.g. lease + furniture" /></label>
      <label className={label}>Still to invest before that date, not in the books yet ({currency})<input className={field} inputMode="numeric" value={g.planned} onChange={set("planned")} placeholder="0" /></label>
      <label className={label}>What it is<input className={field} value={g.plannedNote} onChange={set("plannedNote")} maxLength={200} placeholder="e.g. lease year 2027-04 → 2028-03" /></label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <button className={primary} disabled={act.pending || !g.byDate}>Save</button>
        <button type="button" className={secondary} onClick={onDone}>Cancel</button>
        {act.error && <p className="text-sm text-red-600">{act.error}</p>}
      </div>
    </form>
  );
}

function Blocks({ blocks, villas, today }: { blocks: Props["blocks"]; villas: { id: string; name: string }[]; today: string }) {
  const [b, setB] = useState({ villaId: villas[0]?.id ?? "", start: "", end: "", reason: "owner" as "owner" | "works" | "other", note: "" });
  const act = useAction();
  const router = useRouter();
  const name = (id: string) => villas.find((v) => v.id === id)?.name ?? "";
  const nights = (s: string, e: string) => Math.round((Date.parse(e) - Date.parse(s)) / 86_400_000);
  const REASON = { owner: "Our own stay", works: "Works", other: "Other" } as Record<string, string>;
  return (
    <section className="flex flex-col gap-3 border-t border-zinc-100 pt-5 dark:border-zinc-800">
      <h2 className="font-semibold">Blocked nights</h2>
      <p className="text-sm text-zinc-500">Nights not for sale (your own stays, works): occupancy leaves them out. You can also tell Sply on Telegram.</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
        e.preventDefault();
        act.run(() => addBlock({ ...b, note: b.note || null }), () => { setB({ ...b, start: "", end: "", note: "" }); router.refresh(); });
      }}>
        {villas.length > 1 && (
          <select className={field} value={b.villaId} onChange={(e) => setB({ ...b, villaId: e.target.value })} aria-label="Villa">
            {villas.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
        <label className="flex flex-col gap-1 text-xs text-zinc-500">First night<input type="date" className={field} value={b.start} onChange={(e) => setB({ ...b, start: e.target.value })} /></label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">Until (the morning it ends)<input type="date" className={field} value={b.end} onChange={(e) => setB({ ...b, end: e.target.value })} /></label>
        <select className={field} value={b.reason} onChange={(e) => setB({ ...b, reason: e.target.value as typeof b.reason })} aria-label="Reason">
          {Object.entries(REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className={`${field} min-w-40 flex-1`} value={b.note} onChange={(e) => setB({ ...b, note: e.target.value })} placeholder="Note (optional)" maxLength={200} />
        <button className={primary} disabled={act.pending || !b.start || !b.end}>Add</button>
      </form>
      {act.error && <p className="text-sm text-red-600">{act.error}</p>}
      {blocks.map((x) => (
        <div key={x.id} className={`flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-2 text-sm dark:border-zinc-800 ${x.end < today ? "text-zinc-500" : ""}`}>
          <span>{villas.length > 1 ? `${name(x.villaId)} · ` : ""}{day(x.start)} → {day(x.end)} · {nights(x.start, x.end)} nights · {REASON[x.reason] ?? x.reason}{x.note ? ` · ${x.note}` : ""}</span>
          <button className={secondary} disabled={act.pending} onClick={() => act.run(() => deleteBlock(x.id), () => router.refresh())}>Remove</button>
        </div>
      ))}
    </section>
  );
}
