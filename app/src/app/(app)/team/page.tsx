import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { TeamView } from "@/components/team/TeamView";
import { todayIn } from "@/lib/format/date";
import { getCurrentOrg } from "@/lib/org";
import { logsBetween, payPeriod, payroll } from "@/lib/staff/ops";
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
  const lines = await payroll(db, org.id, month);
  const staff = lines.map((l) => l.staff);
  // The calendar shows the pay period of the most common payday (25 → 26 of last month to the 25th).
  const paydays = staff.map((s) => s.payday);
  const payday = paydays.sort((a, b) => paydays.filter((x) => x === b).length - paydays.filter((x) => x === a).length)[0] ?? 25;
  const period = payPeriod(month, payday);
  const logs = await logsBetween(db, org.id, period.from, period.to);
  return (
    <TeamView
      month={month} today={today} period={period} lines={lines} logs={logs}
      villas={org.villas.map((v) => ({ id: v.id, name: v.name }))} categories={cats ?? []} currency={org.reportingCurrency}
    />
  );
}
