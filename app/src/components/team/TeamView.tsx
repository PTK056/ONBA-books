import { ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import Link from "next/link";
import { money } from "@/components/overview/format";
import { Highlight, MiniStat } from "@/components/shell/Highlight";
import { PageHeader } from "@/components/shell/PageHeader";
import { LogWork } from "@/components/team/LogWork";
import { AddStaff, DeleteLog, EditStaff, PayButton, PrepareButton } from "@/components/team/TeamForms";
import { shortDate } from "@/lib/format/date";
import { describePay, monthLabel, type Log, type PayLine } from "@/lib/staff/ops";

const MODE = { monthly: "Monthly", hourly: "Per hour", per_job: "Per job" };
const shift = (month: string, n: number) => {
  const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

type Option = { id: string; name: string };

/** Staff, who worked when, and the month's pay. Shared by the page and its dev preview. */
export function TeamView({ month, today, period, lines, logs, villas, categories, currency }: {
  month: string; today: string; period: { from: string; to: string; days: number };
  lines: PayLine[]; logs: Log[]; villas: Option[]; categories: Option[]; currency: string;
}) {
  const staff = lines.map((l) => l.staff);
  const formProps = { villas, categories, currency };
  const dates = Array.from({ length: period.days }, (_, i) => new Date(Date.parse(period.from) + i * 86_400_000).toISOString().slice(0, 10));
  const name = new Map(staff.map((s) => [s.id, s.name]));
  const toPrepare = lines.some((l) => l.staff.active && l.run?.status !== "paid");
  const total = lines.reduce((s, l) => s + (l.run?.amount ?? l.computed.total), 0);
  const unpaid = lines.filter((l) => l.run?.status !== "paid");
  const toPay = unpaid.reduce((s, l) => s + (l.run?.amount ?? l.computed.total), 0);

  return (
    <>
      <PageHeader
        title="Team"
        description="Who works for you, when, and what they are owed."
        actions={
          <div className="flex items-center gap-1">
            <Link href={`/team?month=${shift(month, -1)}`} aria-label="Previous month" className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"><ChevronLeft size={16} /></Link>
            <span className="min-w-32 text-center text-sm font-medium">{monthLabel(month)}</span>
            <Link href={`/team?month=${shift(month, 1)}`} aria-label="Next month" className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"><ChevronRight size={16} /></Link>
          </div>
        }
      />

      {lines.length > 0 && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Highlight
            className="col-span-2" label={`Pay for ${monthLabel(month)}`} icon={<Wallet size={16} />}
            value={money(total, currency)} unit={currency}
            note={`${lines.length - unpaid.length} of ${lines.length} paid`}
          />
          <MiniStat label="Still to pay" value={money(toPay, currency)} unit={currency} />
          <MiniStat label="Team" value={String(staff.filter((s) => s.active).length)} unit="active" />
        </section>
      )}

      {/* Pay */}
      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Pay</h2>
            <p className="text-sm text-zinc-500">Work from {shortDate(period.from)} to {shortDate(period.to)}. Marking a pay as paid books the expense.</p>
          </div>
          {toPrepare && staff.length > 0 && <PrepareButton month={month} label={lines.some((l) => l.run) ? "Update drafts" : "Prepare payroll"} />}
        </div>
        {lines.length === 0 ? (
          <p className="text-sm text-zinc-500">No one yet. Add the people who work for you below.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-4 font-normal">Person</th><th className="py-2 pr-4 font-normal">How</th>
                  <th className="py-2 pr-4 text-right font-normal">Days</th><th className="py-2 pr-4 text-right font-normal">Amount</th>
                  <th className="py-2 text-right font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(({ staff: s, computed, run }) => (
                  <tr key={s.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800/60">
                    <td className="py-3 pr-4"><div className="font-medium">{s.name}</div><div className="text-xs text-zinc-500">{[s.role, s.kind === "freelance" ? "freelance" : null].filter(Boolean).join(" · ")}</div></td>
                    <td className="py-3 pr-4 text-zinc-600 dark:text-zinc-300">{describePay(run?.breakdown ?? computed, { period: false })}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{computed.days_worked}</td>
                    <td className="py-3 pr-4 text-right font-medium tabular-nums">{money(run?.amount ?? computed.total, s.currency)}</td>
                    <td className="py-3 text-right">
                      {run?.status === "paid" ? (
                        <Link href={`/transactions/${run.transaction_id}`} className="text-brand-700 hover:underline dark:text-brand-300">Paid {shortDate(run.paid_on!)}</Link>
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
            </table>
          </div>
        )}
      </section>

      {/* Who worked when */}
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Who worked when</h2>
            <p className="text-sm text-zinc-500">Log it here, or tell Sply: &ldquo;Delia did the cleaning today&rdquo;.</p>
          </div>
          <LogWork staff={staff.filter((s) => s.active)} villas={villas} today={today >= period.from && today <= period.to ? today : period.to} />
        </div>
        {staff.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white pr-3 text-left font-medium dark:bg-zinc-950" />
                  {dates.map((d) => <th key={d} className="w-7 text-center font-normal text-zinc-400">{+d.slice(8, 10)}</th>)}
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id}>
                    <td className="sticky left-0 bg-white py-1 pr-3 font-medium dark:bg-zinc-950">{s.name}</td>
                    {dates.map((d) => {
                      const ls = logs.filter((l) => l.staff_id === s.id && l.date === d);
                      const hours = ls.reduce((n, l) => n + (l.hours ?? 0), 0);
                      const jobs = ls.reduce((n, l) => n + (l.jobs ?? 0), 0);
                      const extra = ls.some((l) => l.extra_amount);
                      const text = hours ? `${hours}h` : jobs > 1 ? `×${jobs}` : jobs ? "●" : extra ? "+" : "";
                      return <td key={d} title={ls.map((l) => l.task).filter(Boolean).join(", ")} className={`h-7 w-7 rounded text-center ${text ? "bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200" : ""}`}>{text}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {logs.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-zinc-500 marker:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
              {logs.length} logged {logs.length === 1 ? "day" : "days"}
            </summary>
            <ul className="mt-2 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {[...logs].reverse().map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                  <span><span className="text-zinc-500">{shortDate(l.date)}</span> · <span className="font-medium">{name.get(l.staff_id)}</span>
                    {" · "}{[l.hours && `${l.hours} h`, l.jobs && l.jobs > 1 && `${l.jobs} jobs`, l.extra_amount && `+${money(l.extra_amount, currency)}`, l.task].filter(Boolean).join(" · ") || "1 visit"}</span>
                  <DeleteLog id={l.id} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* People */}
      <section className="card p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">People</h2>
          <AddStaff {...formProps} />
        </div>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {staff.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <span className="font-medium">{s.name}</span>
                {!s.active && <span className="ml-2 bg-zinc-100 px-1.5 py-0.5 badge-label text-zinc-500 dark:bg-zinc-800">inactive</span>}
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
