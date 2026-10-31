// Development-only preview of the Team page with synthetic staff and work, no Supabase needed.
// The buttons call the real server actions, so they fail here: this is for looking only.

import { notFound } from "next/navigation";
import { TeamView } from "@/components/team/TeamView";
import { computePay, payPeriod } from "@/lib/staff/pay";
import type { Log, PayLine, Staff } from "@/lib/staff/ops";

const MONTH = "2026-09";
const base = { kind: "employee", villa_id: null, payday: 25, category_id: null, phone: null, notes: null, active: true, currency: "IDR",
  monthly_amount: null, hourly_rate: null, job_rate: null, base_unit: null, base_per_week: null, extra_rate: null } as const;
const STAFF: Staff[] = [
  { ...base, id: "kadek", name: "Kadek", role: "Housekeeper", pay_mode: "monthly", monthly_amount: 3_250_000, base_unit: "visits", base_per_week: 5, extra_rate: 150_000 },
  { ...base, id: "delia", name: "Delia", role: "Cleaner", kind: "freelance", pay_mode: "per_job", job_rate: 200_000 },
  { ...base, id: "wayan", name: "Wayan", role: "Gardener", pay_mode: "hourly", hourly_rate: 40_000 },
];

const period = payPeriod(MONTH, 25);
const day = (i: number) => new Date(Date.parse(period.from) + i * 86_400_000).toISOString().slice(0, 10);
const LOGS: Log[] = [
  ...Array.from({ length: 30 }, (_, i) => i).filter((i) => i % 7 < 5 || i === 13).map((i) => ({ staff_id: "kadek", date: day(i), hours: null, jobs: 1, extra_amount: null, task: "Daily cleaning" })),
  ...[2, 6, 9, 13, 18, 22, 27].map((i) => ({ staff_id: "delia", date: day(i), hours: null, jobs: i === 13 ? 2 : 1, extra_amount: null, task: "Full cleaning after check-out" })),
  ...[1, 8, 15, 22, 29].map((i) => ({ staff_id: "wayan", date: day(i), hours: 4, jobs: null, extra_amount: i === 15 ? 100_000 : null, task: "Garden and pool" })),
].map((l, i) => ({ ...l, id: String(i), villa_id: null, note: null }));

const LINES: PayLine[] = STAFF.map((s) => {
  const computed = computePay(s, LOGS.filter((l) => l.staff_id === s.id), MONTH);
  const run = s.id === "kadek"
    ? { id: "r1", staff_id: s.id, month: MONTH, amount: computed.total, currency: "IDR", breakdown: computed, status: "paid" as const, transaction_id: "t1", paid_on: "2026-09-25" }
    : s.id === "delia" ? { id: "r2", staff_id: s.id, month: MONTH, amount: computed.total, currency: "IDR", breakdown: computed, status: "draft" as const, transaction_id: null, paid_on: null }
    : null;
  return { staff: s, computed, run };
});

export default function DevTeam() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8">
      <TeamView
        month={MONTH} today="2026-09-20" period={period} lines={LINES} logs={LOGS}
        villas={[{ id: "v1", name: "Villa One" }]} categories={[{ id: "c1", name: "Staff" }]} currency="IDR"
      />
    </main>
  );
}
