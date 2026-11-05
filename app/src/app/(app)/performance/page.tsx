import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PerformanceView } from "@/components/performance/PerformanceView";
import { PageHeader } from "@/components/shell/PageHeader";
import { getCurrentOrg } from "@/lib/org";
import { addMonths, facts as liveFacts, goalPath, monthOf } from "@/lib/performance/metrics";
import { loadData, loadOrg, reportView, todayIn } from "@/lib/performance/report";
import { createClient } from "@/lib/supabase/server";

// Writing a report with Claude takes about a minute.
export const maxDuration = 300;

export default function PerformancePage({ searchParams }: PageProps<"/performance">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-8">
      <PageHeader
        title="Performance"
        description="Once a month is closed, Sply Performance compares it with last year and with your goals, and proposes what to do next. Admins only."
      />
      <Suspense fallback={<div className="card h-64 animate-pulse" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/performance">, "searchParams">) {
  const org = await getCurrentOrg();
  if (org.kind === "signed_out") redirect("/login?next=/performance");
  if (org.kind === "none" || !org.villas.length) redirect("/setup");
  if (org.role !== "admin") notFound();
  const db = await createClient();
  const { month: asked } = await searchParams;

  const [full, data, { data: reports }, { data: closes }, { data: blocks }] = await Promise.all([
    loadOrg(db, org.id),
    loadData(db, org.id),
    db.from("performance_reports").select("id, month, status, error, updated_at").eq("organization_id", org.id).order("month", { ascending: false }),
    db.from("month_closes").select("villa_id, month, status").eq("organization_id", org.id).eq("status", "closed"),
    db.from("villa_blocks").select("id, villa_id, starts_on, ends_on, reason, note").eq("organization_id", org.id).order("starts_on", { ascending: false }).limit(60),
  ]);
  const today = todayIn(full.timezone);
  const placeCount = org.villas.length + (org.company ? 1 : 0);
  const closedCount = new Map<string, number>();
  for (const c of closes ?? []) closedCount.set(c.month, (closedCount.get(c.month) ?? 0) + 1);
  const closedMonths = [...closedCount].filter(([, n]) => n >= placeCount).map(([m]) => m).sort().reverse();

  const months = [...new Set([...closedMonths, ...(reports ?? []).map((r) => r.month as string), addMonths(monthOf(today), -1)])].sort().reverse();
  const wanted = typeof asked === "string" && /^\d{4}-\d{2}$/.test(asked) ? `${asked}-01` : null;
  const month = wanted && months.includes(wanted) ? wanted : (reports?.find((r) => r.status === "ready")?.month as string | undefined) ?? closedMonths[0] ?? months[0];

  const report = (reports ?? []).find((r) => r.month === month) ?? null;
  const view = report && report.status !== "running" ? await reportView(db, org.id, report.id) : null;
  let done: Record<string, boolean> = {};
  if (view?.actions.length) {
    const { data: tasks } = await db.from("performance_actions").select("id, task:tasks (done_at)").in("id", view.actions.map((a) => a.id));
    done = Object.fromEntries((tasks ?? []).map((t) => [t.id, !!(t.task as unknown as { done_at: string | null } | null)?.done_at]));
  }
  const f = view?.facts ?? liveFacts(data, month, today, full.reportingCurrency);

  return (
    <PerformanceView
      month={month}
      months={months}
      closed={closedMonths.includes(month)}
      report={report ? { status: report.status, error: report.error, updatedAt: report.updated_at } : null}
      view={view}
      facts={f}
      done={done}
      // The goals as the report saw them (a goal edited or removed since keeps its chart under its own figures).
      paths={Object.fromEntries(f.goals.map((g) => [g.id, goalPath({
        id: g.id, label: g.label, placeId: g.placeId, since: g.since, byDate: g.byDate, target: g.target,
        invested: g.invested, planned: g.planned, plannedNote: g.plannedNote,
      }, data, month)]))}
      goals={data.goals}
      blocks={(blocks ?? []).map((b) => ({ id: b.id, villaId: b.villa_id, start: b.starts_on, end: b.ends_on, reason: b.reason, note: b.note }))}
      villas={org.villas.map((v) => ({ id: v.id, name: v.name }))}
      places={[...org.villas, ...(org.company ? [org.company] : [])].map((v) => ({ id: v.id, name: v.name }))}
      firstEntry={data.entries[0]?.date ?? today}
      today={today}
    />
  );
}
