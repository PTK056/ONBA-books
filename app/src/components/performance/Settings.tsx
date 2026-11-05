"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addBlock, archiveGoal, deleteBlock, saveGoal, type GoalInput } from "@/app/(app)/performance/actions";
import { money as fmt } from "@/components/overview/format";
import type { Goal } from "@/lib/performance/metrics";
import { day, field, primary, secondary, useAction } from "./ui";

export type BlockRow = { id: string; villaId: string; start: string; end: string; reason: string; note: string | null };

export function Goals({ goals, places, firstEntry, currency }: { goals: Goal[]; places: { id: string; name: string }[]; firstEntry: string; currency: string }) {
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

export function Blocks({ blocks, villas, today }: { blocks: BlockRow[]; villas: { id: string; name: string }[]; today: string }) {
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
