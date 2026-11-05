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
  const m = (k: string) => f.metrics[k];
  const write = useAction();
  const analysis = p.view?.analysis ?? null;

  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-wrap items-center gap-3 p-4">
        <select className={field} value={p.month.slice(0, 7)} aria-label="Month"
          onChange={(e) => router.push(`/performance?month=${e.target.value}`)}>
          {p.months.map((x) => <option key={x} value={x.slice(0, 7)}>{monthName(x)}</option>)}
        </select>
        <p className="flex-1 text-sm text-zinc-500">
          {!p.closed ? "Not closed yet: live figures, they can still change. The report comes once the month is closed everywhere."
            : p.report?.status === "ready" ? `Report written on ${day(p.report.updatedAt.slice(0, 10))}.`
            : p.report?.status === "running" ? "The report is being written: refresh in a minute."
            : p.report?.status === "failed" ? `Last try: ${p.report.error ?? "it could not be written."}`
            : "Closed. No report yet."}
        </p>
        {p.closed && p.report?.status !== "running" && (
          <button className={primary} disabled={write.pending} onClick={() => write.run(() => writeReport(p.month), () => router.refresh())}>
            {write.pending ? "Writing… (about a minute)" : p.report?.status === "ready" ? "Rewrite the report" : "Write the report"}
          </button>
        )}
        {write.error && <p className="w-full text-sm text-red-600">{write.error}</p>}
      </section>

      {analysis && (
        <section className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-400">📈 Sply Performance · {monthName(p.month)}</p>
          <p className="mt-2 text-lg font-semibold">{analysis.headline}</p>
          {analysis.goals && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{analysis.goals}</p>}
          {analysis.previous && <p className="mt-2 text-sm text-zinc-500">Last month: {analysis.previous}</p>}
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi f={f} k="occupancy" label="Occupancy" />
        <Kpi f={f} k="adr" label="Rate per night (ADR)" />
        <Kpi f={f} k="revpar" label="Revenue per night available" />
        <Kpi f={f} k="income" label="Income" />
        <Kpi f={f} k="operating" label={f.prepaid.length ? `Result before ${f.prepaid.join(", ")}` : "Operating result"} />
        <Kpi f={f} k="result" label="Result" />
      </section>

      {f.goals.map((g) => (
        <section key={g.id} className="card flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">🎯 {g.label} <span className="font-normal text-zinc-500">by {day(g.byDate)}</span></h2>
            <span className={`px-2 py-0.5 badge-label ${verdict(f, g.key, g.target).tone}`}>{verdict(f, g.key, g.target).text}</span>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Cumulative result" v={m(`${g.key}.cumulative`)} cur={cur} />
            <Stat label="Needed per month" v={m(`${g.key}.required_per_month`)} cur={cur} hint={f.prepaid.length ? `before ${f.prepaid.join(", ")}` : undefined} />
            <Stat label="Last 3 months, per month" v={m(`${g.key}.pace3`)} cur={cur} />
            <Stat label={`On ${day(g.byDate)}, as last year`} v={m(`${g.key}.projected`) ?? m(`${g.key}.projected_at_pace`)} cur={cur} />
          </dl>
          {p.paths[g.id] && <GoalChart path={p.paths[g.id]} currency={cur} />}
          <p className="text-xs text-zinc-500">
            Counted from {day(g.since)}: {g.placeId ? `every validated entry of ${p.places.find((x) => x.id === g.placeId)?.name ?? "the villa"}.` : "every validated entry, villas and company."}
            {m(`${g.key}.committed`) ? ` ${show(m(`${g.key}.committed`), cur)} paid ahead still to come is counted.` : ""}
            {g.planned ? ` Planned, not in the books yet: ${fmt(g.planned, cur)}${g.plannedNote ? ` (${g.plannedNote})` : ""}.` : ""}
            {m(`${g.key}.roi`) ? ` Return on the ${fmt(g.invested ?? 0, cur, true)} invested: ${show(m(`${g.key}.roi`), cur)}.` : ""}
          </p>
        </section>
      ))}

      {analysis && (analysis.wins.length > 0 || analysis.issues.length > 0) && (
        <section className="grid gap-3 sm:grid-cols-2">
          <Points title="✅ Went well" items={analysis.wins} />
          <Points title="⚠️ To watch" items={analysis.issues} />
        </section>
      )}

      {p.view && p.view.actions.length > 0 && <Actions actions={p.view.actions} done={p.done} currency={cur} />}

      <Calendar f={f} />
      <MonthsTable months={f.months} currency={cur} />

      {(f.anomalies.length > 0 || f.missing.length > 0) && (
        <section className="card flex flex-col gap-3 p-5 text-sm">
          {f.anomalies.length > 0 && (
            <div>
              <h2 className="font-semibold">Unusual expenses</h2>
              <ul className="mt-1 list-disc pl-5">
                {f.anomalies.map((a) => (
                  <li key={a.category}>{a.category}: {fmt(a.amount, cur)} {cur}, against {fmt(a.average, cur)} a month on average{a.ratio ? ` (×${a.ratio.toFixed(1)})` : " (new)"}.</li>
                ))}
              </ul>
            </div>
          )}
          {f.missing.length > 0 && (
            <div>
              <h2 className="font-semibold">Missing from the figures</h2>
              <ul className="mt-1 list-disc pl-5 text-zinc-600 dark:text-zinc-400">{f.missing.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      <Goals goals={p.goals} places={p.places} firstEntry={p.firstEntry} currency={cur} />
      <Blocks blocks={p.blocks} villas={p.villas} today={p.today} />
    </div>
  );
}

function verdict(f: Facts, key: string, target: number): { text: string; tone: string } {
  const good = "bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100";
  const bad = "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100";
  const g = f.goals.find((x) => x.key === key);
  if (g?.over) return g.reached ? { text: "Reached", tone: good } : { text: "Not reached", tone: bad };
  const proj = f.metrics[`${key}.projected`] ?? f.metrics[`${key}.projected_at_pace`];
  if (!proj || proj.value === null) return { text: "Not enough history", tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" };
  return proj.value >= target ? { text: "On track", tone: good } : { text: `${fmt(target - proj.value, f.currency, true)} short`, tone: bad };
}

function Kpi({ f, k, label }: { f: Facts; k: string; label: string }) {
  const v = f.metrics[`month.${k}`], ly = f.metrics[`last_year.${k}`], p3 = f.metrics[`prev3.${k}`];
  return (
    <div className="card p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{v ? show(v, f.currency) : "—"}</p>
      <p className="mt-1 text-xs text-zinc-500">
        {[ly && `Last year ${show(ly, f.currency)}`, p3 && `3 months before ${show(p3, f.currency)}`].filter(Boolean).join(" · ") || " "}
      </p>
    </div>
  );
}

function Stat({ label, v, cur, hint }: { label: string; v: Facts["metrics"][string] | undefined; cur: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`font-semibold tabular-nums ${v?.value !== null && v && v.value < 0 ? "text-amber-700 dark:text-amber-300" : ""}`}>{v ? show(v, cur) : "—"}</dd>
      {hint && <dd className="text-xs text-zinc-500">{hint}</dd>}
    </div>
  );
}

function Points({ title, items }: { title: string; items: { text: string }[] }) {
  if (!items.length) return <div />;
  return (
    <div className="card p-5">
      <h2 className="font-semibold">{title}</h2>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm">{items.map((x) => <li key={x.text}>{x.text}</li>)}</ul>
    </div>
  );
}

function Actions({ actions, done, currency }: { actions: ReportView["actions"]; done: Record<string, boolean>; currency: string }) {
  const router = useRouter();
  const act = useAction();
  return (
    <section className="card flex flex-col gap-3 p-5">
      <h2 className="font-semibold">👉 This month</h2>
      {actions.map((a) => (
        <div key={a.id} className={`flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800 ${a.status === "dismissed" ? "opacity-50" : ""}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-medium">{a.position}. {a.title}</p>
            <span className="text-xs text-zinc-500">
              {[a.impact !== null && `≈ ${a.impact >= 0 ? "+" : ""}${fmt(a.impact, currency, true)} ${currency}/month`, `effort ${a.effort}`, a.dueOn && `by ${day(a.dueOn)}`].filter(Boolean).join(" · ")}
            </span>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{a.why}</p>
          {a.impactNote && <p className="text-xs text-zinc-500">Estimate: {a.impactNote}</p>}
          <div className="flex items-center gap-2">
            {a.status === "proposed" ? (
              <>
                <button className={primary} disabled={act.pending} onClick={() => act.run(() => acceptAction(a.id), () => router.refresh())}>➕ Add to my tasks</button>
                <button className={secondary} disabled={act.pending} onClick={() => act.run(() => dismissAction(a.id), () => router.refresh())}>Not now</button>
              </>
            ) : (
              <span className="text-sm text-zinc-500">{a.status === "dismissed" ? "Set aside" : done[a.id] ? "Done ✅" : "In your tasks"}</span>
            )}
          </div>
        </div>
      ))}
      {act.error && <p className="text-sm text-red-600">{act.error}</p>}
    </section>
  );
}

/** Cumulative result, month by month, and where it heads (dashed) against the target (line). */
function GoalChart({ path, currency }: { path: GoalPath; currency: string }) {
  const pts = [...path.actual, ...path.projection.slice(1)];
  if (pts.length < 2) return null;
  const W = 640, H = 200, L = 52, R = 8, T = 10, B = 22;
  const vals = [...pts.map((x) => x.value), path.target];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 1;
  const y0 = lo - pad, y1 = hi + pad;
  const x = (i: number) => L + (i / (pts.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const line = (from: number, list: { value: number }[]) => list.map((q, i) => `${i ? "L" : "M"}${x(from + i).toFixed(1)},${y(q.value).toFixed(1)}`).join(" ");
  const nActual = path.actual.length;
  const ticks = [y0 + pad, (y0 + y1) / 2, y1 - pad];
  const every = Math.max(1, Math.ceil(pts.length / 8));
  return (
    <figure className="viz-root">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Cumulative result against the goal">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.6">{fmt(t, currency, true)}</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(path.target)} y2={y(path.target)} stroke="var(--series-expenses)" strokeWidth="1.5" />
        <text x={W - R} y={y(path.target) - 4} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.7">Target</text>
        <path d={line(0, path.actual)} fill="none" stroke="var(--series-income)" strokeWidth="2.5" />
        {path.projection.length > 1 && (
          <path d={line(nActual - 1, path.projection)} fill="none" stroke="var(--series-income)" strokeWidth="2" strokeDasharray="5 4" opacity="0.7" />
        )}
        {pts.map((q, i) => (i % every === 0 || i === pts.length - 1) && (
          <text key={q.month} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.6">
            {new Date(`${q.month}T00:00:00Z`).toLocaleDateString("en", { month: "short", year: "2-digit", timeZone: "UTC" })}
          </text>
        ))}
      </svg>
      <figcaption className="mt-1 text-xs text-zinc-500">Solid: cumulative result so far. Dashed: the months left as the same months last year, less what is already committed.</figcaption>
    </figure>
  );
}

function Calendar({ f }: { f: Facts }) {
  const c = f.calendar;
  if (!c.strip.length) return null;
  const color = { b: "bg-brand-600", x: "bg-zinc-400 dark:bg-zinc-600", ".": "bg-zinc-100 dark:bg-zinc-800" } as Record<string, string>;
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
          <div className="flex gap-px" aria-label={`${s.villa}: next ${c.days} days`}>
            {[...s.days].map((d, i) => {
              const date = new Date(Date.parse(`${c.from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
              const orphan = d === "." && c.gaps.some((g) => g.villa === s.villa && g.orphan && g.start <= date && date < g.end);
              return <span key={i} title={`${date}: ${d === "b" ? "booked" : d === "x" ? "blocked" : orphan ? "free, gap too short" : "free"}`}
                className={`h-6 flex-1 rounded-[2px] ${orphan ? "bg-amber-300 dark:bg-amber-700" : color[d]}`} />;
            })}
          </div>
        </div>
      ))}
      <p className="text-xs text-zinc-500">Blue: booked · grey: blocked · amber: a gap of 1–2 nights, hard to sell · light: free.</p>
    </section>
  );
}

function MonthsTable({ months, currency }: { months: MonthFigures[]; currency: string }) {
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(0)}%`);
  const m = (v: number | null) => (v === null ? "—" : fmt(v, currency, true));
  return (
    <section className="card overflow-x-auto p-5">
      <h2 className="mb-3 font-semibold">Month by month</h2>
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
    <section className="card flex flex-col gap-3 p-5">
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
    <section className="card flex flex-col gap-3 p-5">
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
