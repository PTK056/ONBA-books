"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addWork, pay, prepare, removeWork, saveStaff, type Result } from "@/app/(app)/team/actions";
import { parseAmount } from "@/components/review/amount";
import type { Staff } from "@/lib/staff/ops";

const field = "h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm shadow-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-900";
const primary = "h-10 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50";
const secondary = "h-10 rounded-lg border border-zinc-300 px-4 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const label = "flex flex-col gap-1 text-sm font-medium";

type Option = { id: string; name: string };

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = (fn: () => Promise<Result>, after?: () => void) => start(async () => {
    setError(null);
    const r = await fn();
    if (!r.ok) { setError(r.error); return; }
    after?.();
    router.refresh();
  });
  return { error, pending, go };
}

/** Amounts as typed: "2000000", "2.000.000", "150k", "2m". */
function amount(text: string, currency: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s/g, "");
  if (!t) return null;
  const short = t.match(/^(\d+(?:[.,]\d+)?)([km])$/);
  if (short) return Math.round(Number(short[1].replace(",", ".")) * (short[2] === "k" ? 1_000 : 1_000_000));
  return parseAmount(t, currency);
}

/** Add or edit a person, with the way they are paid. */
export function StaffForm({ person, villas, categories, currency, onDone }: {
  person?: Staff; villas: Option[]; categories: Option[]; currency: string; onDone?: () => void;
}) {
  const [mode, setMode] = useState<Staff["pay_mode"]>(person?.pay_mode ?? "monthly");
  const [baseUnit, setBaseUnit] = useState<"" | "visits" | "hours">(person?.base_unit ?? "");
  const { error, pending, go } = useAction();
  const s = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

  function submit(form: FormData) {
    const get = (k: string) => String(form.get(k) ?? "");
    const cur = get("currency").toUpperCase() || currency;
    go(() => saveStaff(person?.id ?? null, {
      name: get("name"), role: get("role"), kind: get("kind") as Staff["kind"], villa_id: get("villa_id") || null,
      pay_mode: mode, currency: cur,
      monthly_amount: amount(get("monthly_amount"), cur), hourly_rate: amount(get("hourly_rate"), cur), job_rate: amount(get("job_rate"), cur),
      base_unit: baseUnit || null, base_per_week: baseUnit ? Number(get("base_per_week")) || null : null, extra_rate: amount(get("extra_rate"), cur),
      payday: Number(get("payday")) || 25, category_id: get("category_id") || null, phone: get("phone"), notes: get("notes"),
      active: get("active") !== "off",
    }), onDone);
  }

  return (
    <form action={submit} className="grid gap-4 sm:grid-cols-2">
      <label className={label}>Name<input name="name" required defaultValue={person?.name} className={field} /></label>
      <label className={label}>Role<input name="role" defaultValue={person?.role ?? ""} placeholder="Housekeeper, manager, pool…" className={field} /></label>
      <label className={label}>Type
        <select name="kind" defaultValue={person?.kind ?? "employee"} className={field}>
          <option value="employee">Employee</option><option value="freelance">Freelance</option>
        </select>
      </label>
      <label className={label}>Villa
        <select name="villa_id" defaultValue={person?.villa_id ?? villas[0]?.id ?? ""} className={field}>
          <option value="">—</option>{villas.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>

      <fieldset className="sm:col-span-2 flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <legend className="px-1 text-sm font-semibold">How they are paid</legend>
        <div className="flex flex-wrap gap-2">
          {([["monthly", "Monthly"], ["hourly", "Per hour"], ["per_job", "Per job"]] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setMode(v)}
              className={`h-9 rounded-lg border px-3 text-sm ${mode === v ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "border-zinc-300 dark:border-zinc-700"}`}>{l}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {mode === "monthly" && <label className={label}>Monthly amount<input name="monthly_amount" inputMode="decimal" required defaultValue={s(person?.monthly_amount)} placeholder="2000000" className={field} /></label>}
          {mode === "hourly" && <label className={label}>Hourly rate<input name="hourly_rate" inputMode="decimal" required defaultValue={s(person?.hourly_rate)} placeholder="25000" className={field} /></label>}
          {mode === "per_job" && <label className={label}>Rate per job<input name="job_rate" inputMode="decimal" required defaultValue={s(person?.job_rate)} placeholder="150000" className={field} /></label>}
          <label className={label}>Currency<input name="currency" defaultValue={person?.currency ?? currency} maxLength={3} className={`${field} uppercase`} /></label>
          <label className={label}>Payday (day of month)<input name="payday" type="number" min={1} max={28} defaultValue={person?.payday ?? 25} className={field} /></label>
        </div>
        {mode === "monthly" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={label}>Included each week
              <select value={baseUnit} onChange={(e) => setBaseUnit(e.target.value as typeof baseUnit)} className={field}>
                <option value="">Nothing set (fixed pay)</option><option value="visits">A number of visits</option><option value="hours">A number of hours</option>
              </select>
            </label>
            {baseUnit && <label className={label}>{baseUnit === "visits" ? "Visits" : "Hours"} per week<input name="base_per_week" inputMode="decimal" required defaultValue={s(person?.base_per_week)} className={field} /></label>}
            {baseUnit && <label className={label}>Rate per extra {baseUnit === "visits" ? "visit" : "hour"}<input name="extra_rate" inputMode="decimal" defaultValue={s(person?.extra_rate)} placeholder="Default: pay ÷ base" className={field} /></label>}
          </div>
        )}
        <p className="text-xs text-zinc-500">
          {mode === "monthly" && (baseUnit ? "Paid the monthly amount; work beyond the weekly base is paid as extras." : "Paid the monthly amount. Extras can be logged as amounts.")}
          {mode === "hourly" && "Paid for the hours logged in the month."}
          {mode === "per_job" && "Paid for each job logged in the month (a day counts as one job unless you say more)."}
        </p>
      </fieldset>

      <label className={label}>Expense category for their pay
        <select name="category_id" defaultValue={person?.category_id ?? ""} className={field}>
          <option value="">Automatic (salaries / staff)</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className={label}>Phone<input name="phone" defaultValue={person?.phone ?? ""} className={field} /></label>
      <label className={`${label} sm:col-span-2`}>Notes<input name="notes" defaultValue={person?.notes ?? ""} className={field} /></label>
      {person && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" value="on" defaultChecked={person.active} /> Still working with us</label>
      )}
      {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button disabled={pending} className={primary}>{pending ? "Saving…" : person ? "Save" : "Add person"}</button>
        {onDone && <button type="button" onClick={onDone} className={secondary}>Cancel</button>}
      </div>
    </form>
  );
}

/** A collapsible "Add person" panel. */
export function AddStaff(props: { villas: Option[]; categories: Option[]; currency: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button onClick={() => setOpen(true)} className={`${primary} inline-flex items-center gap-1.5`}><Plus size={15} />Add person</button>;
  return <div className="card w-full p-5"><StaffForm {...props} onDone={() => setOpen(false)} /></div>;
}

export function EditStaff({ person, ...props }: { person: Staff; villas: Option[]; categories: Option[]; currency: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button onClick={() => setOpen(true)} className="text-sm text-emerald-700 hover:underline dark:text-emerald-300">Edit</button>;
  return <div className="mt-3 w-full"><StaffForm person={person} {...props} onDone={() => setOpen(false)} /></div>;
}

/** Log a day of work: hours, jobs or an extra amount. */
export function LogForm({ staff, villas, today }: { staff: Staff[]; villas: Option[]; today: string }) {
  const { error, pending, go } = useAction();
  const [staffId, setStaffId] = useState(staff[0]?.id ?? "");
  const person = staff.find((p) => p.id === staffId);
  const byHours = person?.pay_mode === "hourly" || person?.base_unit === "hours";

  function submit(form: FormData) {
    const get = (k: string) => String(form.get(k) ?? "");
    go(() => addWork({
      staff_id: staffId, date: get("date"), villa_id: get("villa_id") || null,
      hours: byHours ? Number(get("hours")) || null : null, jobs: !byHours ? Number(get("jobs")) || null : null,
      extra_amount: amount(get("extra_amount"), person?.currency ?? ""), task: get("task"),
    }));
  }

  if (!staff.length) return <p className="text-sm text-zinc-500">Add a person first.</p>;
  return (
    <form action={submit} className="grid items-end gap-3 sm:grid-cols-6">
      <label className={`${label} sm:col-span-2`}>Who
        <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={field}>
          {staff.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className={label}>Date<input name="date" type="date" required defaultValue={today} className={field} /></label>
      {byHours
        ? <label className={label}>Hours<input name="hours" inputMode="decimal" placeholder="3" className={field} /></label>
        : <label className={label}>Visits / jobs<input name="jobs" type="number" min={1} defaultValue={1} className={field} /></label>}
      <label className={label}>Extra amount<input name="extra_amount" inputMode="decimal" placeholder="optional" className={field} /></label>
      <label className={label}>Villa
        <select name="villa_id" defaultValue={person?.villa_id ?? ""} key={staffId} className={field}>
          <option value="">{villas.length === 1 ? villas[0].name : "Their villa"}</option>{villas.length > 1 && villas.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
      <label className={`${label} sm:col-span-5`}>Task<input name="task" placeholder="Full cleaning, garden, check-in…" className={field} /></label>
      <button disabled={pending} className={primary}>{pending ? "Saving…" : "Log work"}</button>
      {error && <p className="text-sm text-red-600 sm:col-span-6">{error}</p>}
    </form>
  );
}

export function DeleteLog({ id }: { id: string }) {
  const { pending, go } = useAction();
  return (
    <button aria-label="Delete this entry" disabled={pending} onClick={() => go(() => removeWork(id))}
      className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 disabled:opacity-50 dark:hover:bg-zinc-800"><Trash2 size={14} /></button>
  );
}

export function PrepareButton({ month, label: text }: { month: string; label: string }) {
  const { error, pending, go } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <button disabled={pending} onClick={() => go(() => prepare(month))} className={primary}>{pending ? "Preparing…" : text}</button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

/** Mark one prepared pay as paid on a date: books the expense. */
export function PayButton({ runId, today }: { runId: string; today: string }) {
  const { error, pending, go } = useAction();
  const [date, setDate] = useState(today);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Payment date" className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <button disabled={pending} onClick={() => go(() => pay(runId, date))} className="h-9 rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">{pending ? "…" : "Mark paid"}</button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
