import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { money } from "@/components/overview/format";
import { PageHeader } from "@/components/shell/PageHeader";
import { AddStaff, DeleteLog, EditStaff, LogForm, PayButton, PrepareButton } from "@/components/team/TeamForms";
import { shortDate, todayIn } from "@/lib/format/date";
import { getCurrentOrg } from "@/lib/org";
import { describePay, monthLabel, monthLogs, payroll } from "@/lib/staff/ops";
import { createClient } from "@/lib/supabase/server";

export default function TeamPage({ searchParams }: PageProps<"/team">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8">
      <Suspense fallback={<div className="card h-96 animate-pulse" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const MODE = { monthly: "Monthly", hourly: "Per hour", per_job: "Per job" };
const shift = (month: string, n: number) => {
  const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/** Staff, who worked when, and the month's pay. */
async function Content({ searchParams }: Pick<PageProps<"/team">, "searchParams">) {
  const org = await getCurrentOrg();
  if (org.kind === "signed_out") redirect("/login?next=/team");
  if (org.kind === "none") redirect("/setup");
  if (org.role === "owner_viewer") notFound();
  const db = await createClient();
  const [{ data: o }, { data: cats }] = await Promise.all([
    db.from("organizations").select("timezone").eq("id", org.id).single(),
    db.from("categories").select("id, name").eq("organization_id", org.id).eq("kind", "expense").is("archived_at", null).order("name"),
  ]);
  const today = todayIn(o?.timezone ?? "UTC");
  const sp = await searchParams;
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const [lines, logs] = await Promise.all([payroll(db, org.id, month), monthLogs(db, org.id, month)]);
  const staff = lines.map((l) => l.staff);
  const villas = org.villas.map((v) => ({ id: v.id, name: v.name }));
  const formProps = { villas, categories: cats ?? [], currency: org.reportingCurrency };
  const days = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const name = new Map(staff.map((s) => [s.id, s.name]));
  const toPrepare = lines.some((l) => l.staff.active && l.run?.status !== "paid");
  const total = lines.reduce((s, l) => s + (l.run?.amount ?? l.computed.total), 0);

  return (
    <>
      <PageHeader
        title="Team"
        description="Who works for you, who worked when, and what they are owed."
        actions={
          <div className="flex items-center gap-1">
            <Link href={`/team?month=${shift(month, -1)}`} aria-label="Previous month" className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"><ChevronLeft size={16} /></Link>
            <span className="min-w-32 text-center text-sm font-medium">{monthLabel(month)}</span>
            <Link href={`/team?month=${shift(month, 1)}`} aria-label="Next month" className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"><ChevronRight size={16} /></Link>
          </div>
        }
      />

      {/* Pay */}
      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Pay for {monthLabel(month)}</h2>
            <p className="text-sm text-zinc-500">Computed from the work logged. Prepare, pay, then mark paid: the expense is booked.</p>
          </div>
          {toPrepare && staff.length > 0 && <PrepareButton month={month} label={lines.some((l) => l.run) ? "Update drafts" : "Prepare payroll"} />}
        </div>
        {lines.length === 0 ? (
          <p className="text-sm text-zinc-500">No one yet. Add the people who work for you below.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-4 font-medium">Person</th><th className="py-2 pr-4 font-medium">How</th>
                  <th className="py-2 pr-4 text-right font-medium">Days</th><th className="py-2 pr-4 text-right font-medium">Amount</th>
                  <th className="py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(({ staff: s, computed, run }) => (
                  <tr key={s.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800/60">
                    <td className="py-3 pr-4"><div className="font-medium">{s.name}</div><div className="text-xs text-zinc-500">{[s.role, s.kind === "freelance" ? "freelance" : null].filter(Boolean).join(" · ")}</div></td>
                    <td className="py-3 pr-4 text-zinc-600 dark:text-zinc-300">{describePay(run?.breakdown ?? computed)}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{computed.days_worked}</td>
                    <td className="py-3 pr-4 text-right font-medium tabular-nums">{money(run?.amount ?? computed.total, s.currency)}</td>
                    <td className="py-3 text-right">
                      {run?.status === "paid" ? (
                        <Link href={`/transactions/${run.transaction_id}`} className="text-emerald-700 hover:underline dark:text-emerald-300">Paid {shortDate(run.paid_on!)}</Link>
                      ) : run ? (
                        run.amount !== computed.total
                          ? <span className="text-xs text-amber-700 dark:text-amber-300">Work changed: update drafts</span>
                          : <PayButton runId={run.id} today={today} />
                      ) : (
                        <span className="text-xs text-zinc-500">Not prepared</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3} className="pt-3 text-right text-zinc-500">Total</td><td className="pt-3 pr-4 text-right font-semibold tabular-nums">{money(total, org.reportingCurrency)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
      </section>

      {/* Who worked when */}
      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Who worked when</h2>
        <p className="mb-4 text-sm text-zinc-500">Log each day of work here, or tell Sply (&ldquo;Delia did the cleaning today&rdquo;).</p>
        <LogForm staff={staff.filter((s) => s.active)} villas={villas} today={today.startsWith(month) ? today : `${month}-01`} />
        {staff.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white pr-3 text-left font-medium dark:bg-zinc-950" />
                  {Array.from({ length: days }, (_, i) => <th key={i} className="w-7 text-center font-normal text-zinc-400">{i + 1}</th>)}
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id}>
                    <td className="sticky left-0 bg-white py-1 pr-3 font-medium dark:bg-zinc-950">{s.name}</td>
                    {Array.from({ length: days }, (_, i) => {
                      const d = `${month}-${String(i + 1).padStart(2, "0")}`;
                      const ls = logs.filter((l) => l.staff_id === s.id && l.date === d);
                      const hours = ls.reduce((n, l) => n + (l.hours ?? 0), 0);
                      const jobs = ls.reduce((n, l) => n + (l.jobs ?? 0), 0);
                      const extra = ls.some((l) => l.extra_amount);
                      const text = hours ? `${hours}h` : jobs > 1 ? `×${jobs}` : jobs ? "●" : extra ? "+" : "";
                      return <td key={d} title={ls.map((l) => l.task).filter(Boolean).join(", ")} className={`h-7 w-7 rounded text-center ${text ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : ""}`}>{text}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {logs.length > 0 && (
          <ul className="mt-6 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {[...logs].reverse().map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                <span><span className="text-zinc-500">{shortDate(l.date)}</span> · <span className="font-medium">{name.get(l.staff_id)}</span>
                  {" · "}{[l.hours && `${l.hours} h`, l.jobs && l.jobs > 1 && `${l.jobs} jobs`, l.extra_amount && `+${money(l.extra_amount, org.reportingCurrency)}`, l.task].filter(Boolean).join(" · ") || "1 visit"}</span>
                <DeleteLog id={l.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* People */}
      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">People</h2>
            <p className="text-sm text-zinc-500">How each person works with you and is paid.</p>
          </div>
          <AddStaff {...formProps} />
        </div>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {staff.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <span className="font-medium">{s.name}</span>
                {!s.active && <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">inactive</span>}
                <div className="text-xs text-zinc-500">
                  {[s.role, s.kind === "freelance" ? "Freelance" : "Employee", MODE[s.pay_mode],
                    s.pay_mode === "monthly" ? money(s.monthly_amount ?? 0, s.currency) : s.pay_mode === "hourly" ? `${money(s.hourly_rate ?? 0, s.currency)}/h` : `${money(s.job_rate ?? 0, s.currency)}/job`,
                    s.base_unit ? `base ${s.base_per_week} ${s.base_unit}/week` : null, `paid on the ${s.payday}`].filter(Boolean).join(" · ")}
                </div>
              </div>
              <EditStaff person={s} {...formProps} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
