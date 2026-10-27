import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computePay, payPeriod, type PayBreakdown, type PayMode, type StaffPay, type WorkLog } from "./pay";

export { payPeriod };

// Staff, work and pay operations, shared by the app (server actions) and the assistant (tools).
// Every call runs with the caller's client, so RLS decides what they may touch.

export interface Staff extends StaffPay {
  id: string;
  name: string;
  role: string | null;
  kind: "employee" | "freelance";
  villa_id: string | null;
  payday: number;
  category_id: string | null;
  phone: string | null;
  notes: string | null;
  active: boolean;
}

export interface Log extends WorkLog { id: string; staff_id: string; villa_id: string | null; task: string | null; note: string | null }
export interface PayRun { id: string; staff_id: string; month: string; amount: number; currency: string; breakdown: PayBreakdown; status: "draft" | "paid"; transaction_id: string | null; paid_on: string | null }

export class StaffError extends Error {}

const STAFF_COLS = "id, name, role, kind, villa_id, pay_mode, currency, monthly_amount, hourly_rate, job_rate, base_unit, base_per_week, extra_rate, payday, category_id, phone, notes, active";
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const toStaff = (r: Record<string, unknown>): Staff => ({
  ...(r as unknown as Staff),
  monthly_amount: num(r.monthly_amount), hourly_rate: num(r.hourly_rate), job_rate: num(r.job_rate),
  base_per_week: num(r.base_per_week), extra_rate: num(r.extra_rate),
});

export async function listStaff(db: SupabaseClient, orgId: string, opts: { activeOnly?: boolean } = {}): Promise<Staff[]> {
  let q = db.from("staff").select(STAFF_COLS).eq("organization_id", orgId).order("name");
  if (opts.activeOnly) q = q.eq("active", true);
  const { data } = await q;
  return (data ?? []).map(toStaff);
}

export interface StaffInput {
  name: string; role?: string | null; kind?: "employee" | "freelance"; villa_id?: string | null;
  pay_mode: PayMode; currency: string; monthly_amount?: number | null; hourly_rate?: number | null; job_rate?: number | null;
  base_unit?: "visits" | "hours" | null; base_per_week?: number | null; extra_rate?: number | null;
  payday?: number; category_id?: string | null; phone?: string | null; notes?: string | null; active?: boolean;
}

/** Keeps only the settings that belong to the pay mode, so a change of mode leaves no stale rate behind. */
function settingsFor(i: StaffInput) {
  const monthly = i.pay_mode === "monthly";
  const hasBase = monthly && !!i.base_unit && !!i.base_per_week;
  return {
    monthly_amount: monthly ? i.monthly_amount ?? null : null,
    hourly_rate: i.pay_mode === "hourly" ? i.hourly_rate ?? null : null,
    job_rate: i.pay_mode === "per_job" ? i.job_rate ?? null : null,
    base_unit: hasBase ? i.base_unit : null,
    base_per_week: hasBase ? i.base_per_week : null,
    extra_rate: monthly ? i.extra_rate ?? null : null,
  };
}

function check(i: StaffInput) {
  if (!i.name?.trim()) throw new StaffError("Give the person's name.");
  if (i.pay_mode === "monthly" && !(Number(i.monthly_amount) >= 0 && i.monthly_amount !== null && i.monthly_amount !== undefined)) throw new StaffError("Give the monthly amount.");
  if (i.pay_mode === "hourly" && !(Number(i.hourly_rate) > 0)) throw new StaffError("Give the hourly rate.");
  if (i.pay_mode === "per_job" && !(Number(i.job_rate) > 0)) throw new StaffError("Give the rate per job.");
  if (!/^[A-Z]{3}$/.test(i.currency)) throw new StaffError("Give a three-letter currency.");
}

const friendly = (m = "") =>
  m.includes("staff_organization_id_name_key") ? "Someone with that name already exists." : "Could not save. Try again.";

export async function createStaff(db: SupabaseClient, orgId: string, i: StaffInput): Promise<Staff> {
  check(i);
  const { data, error } = await db.from("staff").insert({
    organization_id: orgId, name: i.name.trim(), role: i.role?.trim() || null, kind: i.kind ?? "employee", villa_id: i.villa_id ?? null,
    pay_mode: i.pay_mode, currency: i.currency, ...settingsFor(i), payday: i.payday ?? 25, category_id: i.category_id ?? null,
    phone: i.phone?.trim() || null, notes: i.notes?.trim() || null, active: i.active ?? true,
  }).select(STAFF_COLS).single();
  if (error || !data) throw new StaffError(friendly(error?.message));
  return toStaff(data);
}

export async function updateStaff(db: SupabaseClient, orgId: string, id: string, i: StaffInput): Promise<Staff> {
  check(i);
  const { data, error } = await db.from("staff").update({
    name: i.name.trim(), role: i.role?.trim() || null, kind: i.kind ?? "employee", villa_id: i.villa_id ?? null,
    pay_mode: i.pay_mode, currency: i.currency, ...settingsFor(i), payday: i.payday ?? 25, category_id: i.category_id ?? null,
    phone: i.phone?.trim() || null, notes: i.notes?.trim() || null, active: i.active ?? true,
  }).eq("id", id).eq("organization_id", orgId).select(STAFF_COLS).single();
  if (error || !data) throw new StaffError(friendly(error?.message));
  return toStaff(data);
}

export interface LogInput { staff_id: string; date: string; villa_id?: string | null; hours?: number | null; jobs?: number | null; extra_amount?: number | null; task?: string | null; note?: string | null }

export async function logWork(db: SupabaseClient, orgId: string, i: LogInput): Promise<Log> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new StaffError("Give the date.");
  const hours = i.hours && i.hours > 0 ? i.hours : null;
  const extra = i.extra_amount && i.extra_amount > 0 ? i.extra_amount : null;
  // A day of work is one job unless hours, a number of jobs or only an extra amount is given.
  const jobs = i.jobs && i.jobs > 0 ? Math.round(i.jobs) : hours || extra ? null : 1;
  const { data: person } = await db.from("staff").select("villa_id").eq("id", i.staff_id).eq("organization_id", orgId).maybeSingle();
  if (!person) throw new StaffError("Unknown person.");
  const { data, error } = await db.from("work_logs").insert({
    organization_id: orgId, staff_id: i.staff_id, villa_id: i.villa_id ?? person.villa_id ?? null, date: i.date,
    hours, jobs, extra_amount: extra, task: i.task?.trim() || null, note: i.note?.trim() || null,
  }).select("id, staff_id, villa_id, date, hours, jobs, extra_amount, task, note").single();
  if (error || !data) throw new StaffError("Could not save the work. Try again.");
  return { ...data, hours: num(data.hours), extra_amount: num(data.extra_amount) } as Log;
}

export async function deleteLog(db: SupabaseClient, orgId: string, id: string) {
  const { data } = await db.from("work_logs").delete().eq("id", id).eq("organization_id", orgId).select("id").maybeSingle();
  if (!data) throw new StaffError("Unknown entry.");
}

/** Work between two dates (inclusive). A month's pay covers a period that starts in the previous month. */
export async function logsBetween(db: SupabaseClient, orgId: string, from: string, to: string): Promise<Log[]> {
  const { data } = await db.from("work_logs").select("id, staff_id, villa_id, date, hours, jobs, extra_amount, task, note")
    .eq("organization_id", orgId).gte("date", from).lte("date", to).order("date");
  return (data ?? []).map((l) => ({ ...l, hours: num(l.hours), extra_amount: num(l.extra_amount) }) as Log);
}

export interface PayLine { staff: Staff; computed: PayBreakdown; run: PayRun | null }

/** For each active person (and anyone already paid or prepared), what the month's pay comes to, and its run if any. */
export async function payroll(db: SupabaseClient, orgId: string, month: string): Promise<PayLine[]> {
  const [people, logs, runs] = await Promise.all([
    listStaff(db, orgId),
    // Wide enough for any payday (1–28): from the 2nd of the previous month to the 28th of this one.
    logsBetween(db, orgId, payPeriod(month, 1).from, payPeriod(month, 28).to),
    db.from("pay_runs").select("id, staff_id, month, amount, currency, breakdown, status, transaction_id, paid_on")
      .eq("organization_id", orgId).eq("month", `${month}-01`),
  ]);
  const runOf = new Map((runs.data ?? []).map((r) => [r.staff_id, { ...r, amount: Number(r.amount) } as PayRun]));
  return people
    .filter((p) => p.active || runOf.has(p.id))
    .map((p) => ({ staff: p, computed: computePay(p, logs.filter((l) => l.staff_id === p.id), month), run: runOf.get(p.id) ?? null }));
}

/** Creates or refreshes the month's draft pay for everyone not paid yet. Paid runs are never touched. */
export async function preparePayroll(db: SupabaseClient, orgId: string, month: string): Promise<PayLine[]> {
  const lines = await payroll(db, orgId, month);
  for (const l of lines) {
    if (l.run?.status === "paid" || !l.staff.active) continue;
    const row = { amount: l.computed.total, currency: l.staff.currency, breakdown: l.computed };
    const { error } = l.run
      ? await db.from("pay_runs").update(row).eq("id", l.run.id)
      : await db.from("pay_runs").insert({ organization_id: orgId, staff_id: l.staff.id, month: `${month}-01`, ...row });
    if (error) throw new StaffError(`Could not prepare ${l.staff.name}'s pay. Try again.`);
  }
  return payroll(db, orgId, month);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (month: string) => `${MONTHS[+month.slice(5, 7) - 1]} ${month.slice(0, 4)}`;

/** The expense category for someone's pay: theirs, else a staff/salary category of the organization. */
async function payCategory(db: SupabaseClient, orgId: string, s: Staff): Promise<string | null> {
  if (s.category_id) return s.category_id;
  const { data } = await db.from("categories").select("id, name").eq("organization_id", orgId).eq("kind", "expense").is("archived_at", null);
  const hit = (data ?? []).find((c) => /salar/i.test(c.name)) ?? (data ?? []).find((c) => /staff/i.test(c.name));
  return hit?.id ?? null;
}

/** Books a prepared pay as an expense (in the person's villa) and marks it paid. Returns the expense id. */
export async function markPaid(db: SupabaseClient, orgId: string, runId: string, paidOn: string, fxRate = 1): Promise<{ transactionId: string; run: PayRun; staff: Staff }> {
  const { data: run } = await db.from("pay_runs").select("id, staff_id, month, amount, currency, breakdown, status, transaction_id, paid_on")
    .eq("id", runId).eq("organization_id", orgId).maybeSingle();
  if (!run) throw new StaffError("Unknown pay.");
  if (run.status === "paid") throw new StaffError("Already paid.");
  if (!(Number(run.amount) > 0)) throw new StaffError("Nothing to pay this month.");
  const { data: s } = await db.from("staff").select(STAFF_COLS).eq("id", run.staff_id).single();
  const staff = toStaff(s!);
  let villaId = staff.villa_id;
  if (!villaId) {
    const { data: v } = await db.from("villas").select("id").eq("organization_id", orgId).eq("kind", "villa").is("archived_at", null).limit(2);
    if (v?.length !== 1) throw new StaffError(`Set ${staff.name}'s villa first, so the pay is booked in the right place.`);
    villaId = v[0].id;
  }
  const { data: tx, error } = await db.from("transactions").insert({
    organization_id: orgId, villa_id: villaId, date: paidOn, direction: "out", category_id: await payCategory(db, orgId, staff),
    description: `${staff.name} — pay ${monthLabel(run.month.slice(0, 7))}`, currency: run.currency, amount: Number(run.amount),
    fx_rate: fxRate, status: "validated", source: "manual",
  }).select("id").single();
  if (error || !tx) throw new StaffError(error?.message.includes("closed") ? "That month is closed for this villa. Use a payment date in an open month." : "Could not book the pay. Try again.");
  const { data: paid, error: e2 } = await db.from("pay_runs").update({ status: "paid", paid_on: paidOn, transaction_id: tx.id })
    .eq("id", run.id).select("id, staff_id, month, amount, currency, breakdown, status, transaction_id, paid_on").single();
  if (e2 || !paid) throw new StaffError("Booked, but could not mark the pay as paid. Try again.");
  return { transactionId: tx.id, run: { ...paid, amount: Number(paid.amount) } as PayRun, staff };
}

/** Plain-language summary of a pay computation, e.g. "2,000,000 fixed + 2 extra visits × 150,000". */
export function describePay(b: PayBreakdown): string {
  const n = (x: number) => x.toLocaleString("en");
  const parts: string[] = [];
  const short = (d: string) => `${+d.slice(8, 10)}/${+d.slice(5, 7)}`;
  if (b.mode === "monthly") {
    parts.push(`${n(b.fixed ?? 0)} fixed`);
    if (b.base) parts.push(`${n(b.base.done)}/${n(b.base.this_month)} ${b.base.unit} in the period${b.base.extra_units ? `, ${n(b.base.extra_units)} extra × ${n(b.base.extra_rate)}` : ""}`);
  }
  if (b.mode === "hourly") parts.push(`${n(b.hours ?? 0)} h × ${n(b.hourly_rate ?? 0)}`);
  if (b.mode === "per_job") parts.push(`${n(b.jobs ?? 0)} job${b.jobs === 1 ? "" : "s"} × ${n(b.job_rate ?? 0)}`);
  if (b.one_off_extras) parts.push(`+ ${n(b.one_off_extras)} extras`);
  // Pay prepared before periods existed has none recorded.
  return b.period ? `${parts.join(", ")} (work ${short(b.period.from)}–${short(b.period.to)})` : parts.join(", ");
}
