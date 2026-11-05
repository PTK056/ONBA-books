"use client";

import { useState } from "react";
import { money as fmt } from "@/components/overview/format";
import type { Facts, GoalPath } from "@/lib/performance/metrics";
import { bad, day, good, monthName, neutral } from "./ui";
import "@/components/overview/chart.css";

type FactsGoal = Facts["goals"][number];

/**
 * The goals, one at a time: what each month must make against what the last months made, and the cumulative result
 * on a chart that reads month by month on hover. Several goals: tabs.
 */
export function GoalPanel({ f, paths, places, fees }: { f: Facts; paths: Record<string, GoalPath>; places: { id: string; name: string }[]; fees: string | null }) {
  const first = f.goals.find((g) => !g.over) ?? f.goals[0];
  const [selected, setSelected] = useState(first?.id);
  const g = f.goals.find((x) => x.id === selected) ?? first;
  if (!g) return null;
  return (
    <div className="flex flex-col gap-4">
      {f.goals.length > 1 && (
        <div role="tablist" aria-label="Goals" className="flex flex-wrap gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900/70">
          {f.goals.map((x) => {
            const s = status(f, x);
            return (
              <button key={x.id} role="tab" aria-selected={x.id === g.id} onClick={() => setSelected(x.id)}
                className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
                  x.id === g.id ? "bg-white font-semibold shadow-sm dark:bg-zinc-800" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} aria-hidden />
                <span className="truncate">{x.label}</span>
                <span className="hidden shrink-0 font-normal text-zinc-500 sm:inline">· {day(x.byDate)}</span>
              </button>
            );
          })}
        </div>
      )}
      <Goal key={g.id} f={f} g={g} path={paths[g.id]} places={places} fees={fees} named={f.goals.length > 1} />
    </div>
  );
}

function status(f: Facts, g: FactsGoal) {
  const proj = f.metrics[`${g.key}.projected`]?.value ?? f.metrics[`${g.key}.projected_at_pace`]?.value ?? null;
  if (g.over) return g.reached ? { text: "Reached", tone: good, dot: "bg-brand-500" } : { text: "Not reached", tone: bad, dot: "bg-amber-500" };
  if (proj === null) return { text: "Not enough history yet", tone: neutral, dot: "bg-zinc-400" };
  return proj >= g.target ? { text: "On track", tone: good, dot: "bg-brand-500" } : { text: "Off track", tone: bad, dot: "bg-amber-500" };
}

function Goal({ f, g, path, places, fees, named }: { f: Facts; g: FactsGoal; path: GoalPath | undefined; places: { id: string; name: string }[]; fees: string | null; named: boolean }) {
  const cur = f.currency;
  const m = (k: string) => f.metrics[`${g.key}.${k}`]?.value ?? null;
  const need = m("required_per_month"), pace = m("pace3"), proj = m("projected") ?? m("projected_at_pace");
  const s = status(f, g);
  const max = Math.max(need ?? 0, pace ?? 0, 1);
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-start">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.tone}`}>{s.text}</span>
          {!named && <span className="text-sm text-zinc-500">{g.label} by {day(g.byDate)}</span>}
        </div>
        {need !== null && pace !== null && !g.over ? (
          <>
            <p className="text-2xl font-semibold leading-tight tabular-nums">
              {pace >= need
                ? <>Ahead by {fmt(pace - need, cur, true)} <span className="text-base font-normal text-zinc-500">{cur} a month</span></>
                : <>Short by <span className="text-amber-700 dark:text-amber-300">{fmt(need - pace, cur, true)}</span> <span className="text-base font-normal text-zinc-500">{cur} a month</span></>}
            </p>
            <div className="viz-root flex flex-col gap-2.5">
              <Bar label="Needed a month" note={fees ? `before ${fees}` : null} value={need} max={max} cur={cur} color="var(--series-expenses)" />
              <Bar label="Made a month" note="last 3 months" value={pace} max={max} cur={cur} color="var(--series-income)" />
            </div>
            {proj !== null && (
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                At this rate: <b className="tabular-nums">{fmt(proj, cur, true)} {cur}</b> on {day(g.byDate)}, {g.monthsLeft} months from now.
              </p>
            )}
          </>
        ) : (
          <p className="text-2xl font-semibold tabular-nums">{fmt(g.cumulative, cur, true)} <span className="text-base font-normal text-zinc-500">{cur} so far</span></p>
        )}
        <Counted g={g} f={f} places={places} fees={fees} />
      </div>
      {path && <GoalChart path={path} currency={cur} />}
    </div>
  );
}

function Bar({ label, note, value, max, cur, color }: { label: string; note: string | null; value: number; max: number; cur: string; color: string }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span>{label}{note && <span className="text-xs text-zinc-500"> · {note}</span>}</span>
        <span className="font-semibold tabular-nums">{fmt(value, cur, true)}</span>
      </div>
      <span className="h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (Math.max(0, value) / max) * 100)}%`, background: color }} />
      </span>
    </div>
  );
}

/** How a goal's figures are made, folded away. */
function Counted({ g, f, places, fees }: { g: FactsGoal; f: Facts; places: { id: string; name: string }[]; fees: string | null }) {
  const cur = f.currency;
  return (
    <details className="text-xs text-zinc-500">
      <summary className="cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-300">ⓘ How it is counted{g.roi !== null ? ` · return so far ${(g.roi * 100).toFixed(1)}%` : ""}</summary>
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

/** Cumulative result, month by month (solid), where it heads (dashed), against the target; hover reads a month. */
function GoalChart({ path, currency }: { path: GoalPath; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = path.actual.length;
  const pts = [...path.actual, ...path.projection.slice(1)];
  if (pts.length < 2) return null;
  const W = 440, H = 200, L = 4, R = 4, T = 26, B = 22;
  const vals = [...pts.map((q) => q.value), path.target];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 1;
  const y0 = lo - pad, y1 = hi + pad;
  const x = (i: number) => L + (i / (pts.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const line = (from: number, list: { value: number }[]) => list.map((q, i) => `${i ? "L" : "M"}${x(from + i).toFixed(1)},${y(q.value).toFixed(1)}`).join(" ");
  const now = path.actual[n - 1];
  const end = path.projection.length > 1 ? path.projection.at(-1)! : null;
  const years = pts.map((q, i) => ({ i, q })).filter(({ q, i }) => i > 0 && q.month.slice(5, 7) === "01");
  const h = hover === null ? null : { i: hover, q: pts[hover], projected: hover >= n };
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(pts.length - 1, Math.round(((px - L) / (W - L - R)) * (pts.length - 1)))));
  };
  return (
    <figure className="viz-root relative">
      <figcaption className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: "var(--series-income)" }} />Cumulative result</span>
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: "var(--series-income)" }} />Projected</span>
        <span className="ml-auto">{currency}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-none overflow-visible" role="img"
        aria-label={`Cumulative result: ${fmt(now.value, currency, true)} now${end ? `, ${fmt(end.value, currency, true)} projected` : ""}, target ${fmt(path.target, currency, true)}`}
        onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
        <line x1={L} x2={W - R} y1={y(path.target)} y2={y(path.target)} stroke="currentColor" strokeOpacity="0.35" strokeDasharray="2 3" />
        <text x={L} y={y(path.target) - 6} fontSize="12" fill="currentColor" opacity="0.6">Target {fmt(path.target, currency, true)}</text>
        {n > 1 && <path d={`${line(0, path.actual)} L${x(n - 1)},${y(y0)} L${x(0)},${y(y0)} Z`} fill="var(--series-income)" opacity="0.08" />}
        <path d={line(0, path.actual)} fill="none" stroke="var(--series-income)" strokeWidth="2" strokeLinejoin="round" />
        {end && <path d={line(n - 1, path.projection)} fill="none" stroke="var(--series-income)" strokeWidth="2" strokeDasharray="5 4" opacity="0.6" />}
        {years.map(({ i, q }) => (
          <g key={q.month}>
            <line x1={x(i)} x2={x(i)} y1={T} y2={H - B} stroke="var(--grid)" />
            <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.5">{q.month.slice(0, 4)}</text>
          </g>
        ))}
        <text x={L} y={H - 6} fontSize="11" fill="currentColor" opacity="0.5">{monthName(pts[0].month, "short")}</text>
        {h ? (
          <>
            <line x1={x(h.i)} x2={x(h.i)} y1={T - 6} y2={H - B} stroke="currentColor" strokeOpacity="0.4" />
            <circle cx={x(h.i)} cy={y(h.q.value)} r="5" fill="var(--series-income)" strokeWidth="2" className="stroke-white dark:stroke-zinc-900" />
          </>
        ) : (
          <>
            <circle cx={x(n - 1)} cy={y(now.value)} r="5" fill="var(--series-income)" />
            <text x={x(n - 1)} y={y(now.value) - 10} textAnchor="middle" fontSize="12" fontWeight="600" fill="currentColor">Now {fmt(now.value, currency, true)}</text>
            {end && <text x={W - R} y={y(end.value) + (end.value < now.value ? 16 : -9)} textAnchor="end" fontSize="12" fill="currentColor" opacity="0.75">{fmt(end.value, currency, true)}</text>}
          </>
        )}
      </svg>
      {h && (
        <div role="tooltip" className="pointer-events-none absolute top-5 z-10 w-max rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          style={{ left: `${(x(h.i) / W) * 100}%`, transform: `translateX(${h.i > pts.length / 2 ? "calc(-100% - 8px)" : "8px"})` }}>
          <p className="font-medium">{monthName(h.q.month)}{h.projected && <span className="font-normal text-zinc-500"> · projected</span>}</p>
          <p className="tabular-nums">{fmt(h.q.value, currency)} {currency}</p>
          <p className="tabular-nums text-zinc-500">{h.q.value >= path.target ? "Above" : "Below"} target by {fmt(Math.abs(h.q.value - path.target), currency, true)}</p>
        </div>
      )}
    </figure>
  );
}
