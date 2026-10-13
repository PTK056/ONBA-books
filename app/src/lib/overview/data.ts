import "server-only";
import { connection } from "next/server";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export const TREND_MONTHS = 12;
const MAX_ENTRIES = 5000; // 12 months of validated entries; far above a villa's volume
const SIGNED_URL_TTL = 60 * 60;

export interface MonthTotals { month: string; income: number; expenses: number; net: number }

export interface Entry {
  id: string;
  date: string;
  description: string | null;
  merchant: string | null;
  category: string;
  villa: string;
  direction: "in" | "out";
  amount: number;        // reporting currency
  original: { amount: number; currency: string } | null; // when booked in another currency
  receiptUrl: string | null;
}

export interface CategoryLine {
  name: string;
  amount: number;
  count: number;
  share: number;          // of the month's expenses, 0..1
  monthlyAverage: number; // over the months before this one that had expenses in the window
}

export interface VillaMonth {
  id: string;
  name: string;
  income: number;
  expenses: number;
  net: number;
  closed: { at: string } | null;
}

export interface Overview {
  org: { id: string; name: string; reportingCurrency: string; role: "admin" | "staff" | "owner_viewer"; fiscalYearStart: number };
  month: string;
  trend: MonthTotals[];
  totals: MonthTotals;
  previous: MonthTotals;
  year: { from: string; income: number; expenses: number; net: number; months: number; averageExpenses: number; costliest: MonthTotals | null };
  categories: CategoryLine[];
  merchants: { name: string; amount: number; count: number }[];
  entries: Entry[];
  evidence: { expenses: number; withReceipt: number };
  villas: VillaMonth[];
  missingEvidence: { id: string; date: string; description: string | null; amount: number; currency: string }[];
  toReview: number;
  toRead: number;
}

export type OverviewResult =
  | { kind: "signed_out" }
  | { kind: "no_organization" }
  | { kind: "ready"; data: Overview };

const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const iso = (d: Date) => d.toISOString().slice(0, 10);

type Row = {
  id: string;
  date: string;
  direction: "in" | "out";
  amount: number;
  currency: string;
  amount_reporting: number;
  description: string | null;
  villa_id: string;
  category: { name: string } | null;
  evidence: { storage_path: string; extracted: { merchant?: string | null } | null }[];
};

/** Figures for one month (default: the latest month with validated entries) and the 12 months up to it. */
export async function loadOverview(requested?: string): Promise<OverviewResult> {
  await connection();
  const org = await getCurrentOrg();
  if (org.kind === "signed_out") return { kind: "signed_out" };
  if (org.kind === "none") return { kind: "no_organization" };
  const db = await createClient();

  let month: Date;
  if (requested && /^\d{4}-\d{2}$/.test(requested)) {
    month = new Date(`${requested}-01T00:00:00Z`);
  } else {
    const { data: latest } = await db.from("transactions").select("date")
      .eq("organization_id", org.id).eq("status", "validated")
      .order("date", { ascending: false }).limit(1);
    month = monthStart(latest?.[0] ? new Date(`${latest[0].date}T00:00:00Z`) : new Date());
  }
  const from = iso(month);
  const to = iso(addMonths(month, 1));
  const windowFrom = iso(addMonths(month, -(TREND_MONTHS - 1)));

  const [orgRow, txs, missing, closes, toReview, toRead] = await Promise.all([
    db.from("organizations").select("fiscal_year_start").eq("id", org.id).single(),
    db.from("transactions")
      .select("id, date, direction, amount, currency, amount_reporting, description, villa_id, category:categories (name), evidence (storage_path, extracted)")
      .eq("organization_id", org.id).eq("status", "validated")
      .gte("date", windowFrom).lt("date", to)
      .order("date", { ascending: false }).limit(MAX_ENTRIES),
    db.from("expenses_missing_evidence").select("id, date, description, amount, currency")
      .eq("organization_id", org.id).gte("date", from).lt("date", to).order("date"),
    db.from("month_closes").select("villa_id, status, closed_at")
      .eq("organization_id", org.id).eq("month", from),
    db.from("receipt_items").select("id", { count: "exact", head: true })
      .eq("organization_id", org.id).eq("status", "pending").not("read_at", "is", null),
    db.from("receipt_items").select("id", { count: "exact", head: true })
      .eq("organization_id", org.id).eq("status", "pending").is("read_at", null),
  ]);
  const rows = (txs.data ?? []) as unknown as Row[];
  const villaName = new Map(org.villas.map((v) => [v.id, v.name]));

  // Trend: every month of the window, empty ones included.
  const byMonth = new Map<string, MonthTotals>();
  for (let i = 0; i < TREND_MONTHS; i++) {
    const m = iso(addMonths(month, i - (TREND_MONTHS - 1)));
    byMonth.set(m, { month: m, income: 0, expenses: 0, net: 0 });
  }
  const catByMonth = new Map<string, Map<string, number>>(); // category -> month -> amount
  for (const r of rows) {
    const m = `${r.date.slice(0, 7)}-01`;
    const t = byMonth.get(m)!;
    const amt = Number(r.amount_reporting);
    if (r.direction === "in") t.income += amt; else t.expenses += amt;
    t.net = t.income - t.expenses;
    if (r.direction === "out") {
      const name = r.category?.name ?? "Uncategorized";
      const perMonth = catByMonth.get(name) ?? new Map<string, number>();
      perMonth.set(m, (perMonth.get(m) ?? 0) + amt);
      catByMonth.set(name, perMonth);
    }
  }
  const trend = [...byMonth.values()];
  const totals = trend[trend.length - 1];
  const previous = trend[trend.length - 2];

  // Year to date, from the organization's fiscal year start (within the 12-month window).
  const fyStart = orgRow.data?.fiscal_year_start ?? 1;
  const fyYear = month.getUTCMonth() + 1 >= fyStart ? month.getUTCFullYear() : month.getUTCFullYear() - 1;
  const yearFrom = iso(new Date(Date.UTC(fyYear, fyStart - 1, 1)));
  const yearMonths = trend.filter((t) => t.month >= yearFrom);
  const activeMonths = yearMonths.filter((t) => t.expenses > 0 || t.income > 0);
  const yearIncome = yearMonths.reduce((s, t) => s + t.income, 0);
  const yearExpenses = yearMonths.reduce((s, t) => s + t.expenses, 0);

  // The month itself.
  const monthRows = rows.filter((r) => r.date >= from && r.date < to);
  const expenses = monthRows.filter((r) => r.direction === "out");
  const pastMonthsWithExpenses = trend.slice(0, -1).filter((t) => t.expenses > 0).map((t) => t.month);

  const categories: CategoryLine[] = [];
  for (const [name, perMonth] of catByMonth) {
    const amount = perMonth.get(from) ?? 0;
    if (!amount) continue;
    const past = pastMonthsWithExpenses.map((m) => perMonth.get(m) ?? 0);
    categories.push({
      name,
      amount,
      count: expenses.filter((r) => (r.category?.name ?? "Uncategorized") === name).length,
      share: totals.expenses ? amount / totals.expenses : 0,
      monthlyAverage: past.length ? past.reduce((s, x) => s + x, 0) / past.length : 0,
    });
  }
  categories.sort((a, b) => b.amount - a.amount);

  const merchants = new Map<string, { amount: number; count: number }>();
  for (const r of expenses) {
    const name = r.evidence?.[0]?.extracted?.merchant?.trim();
    if (!name) continue;
    const m = merchants.get(name) ?? { amount: 0, count: 0 };
    m.amount += Number(r.amount_reporting);
    m.count++;
    merchants.set(name, m);
  }

  const paths = monthRows.flatMap((r) => (r.evidence?.[0] ? [r.evidence[0].storage_path] : []));
  const { data: signed } = paths.length
    ? await db.storage.from("evidence").createSignedUrls(paths, SIGNED_URL_TTL)
    : { data: [] };
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  const closedBy = new Map((closes.data ?? []).filter((c) => c.status === "closed").map((c) => [c.villa_id, c.closed_at as string]));

  return {
    kind: "ready",
    data: {
      org: { id: org.id, name: org.name, reportingCurrency: org.reportingCurrency, role: org.role, fiscalYearStart: fyStart },
      month: from,
      trend,
      totals,
      previous,
      year: {
        from: yearFrom,
        income: yearIncome,
        expenses: yearExpenses,
        net: yearIncome - yearExpenses,
        months: activeMonths.length,
        averageExpenses: activeMonths.length ? yearExpenses / activeMonths.length : 0,
        costliest: activeMonths.length ? activeMonths.reduce((a, b) => (b.expenses > a.expenses ? b : a)) : null,
      },
      categories,
      merchants: [...merchants].map(([name, m]) => ({ name, ...m })).sort((a, b) => b.amount - a.amount).slice(0, 6),
      entries: monthRows.map((r) => ({
        id: r.id,
        date: r.date,
        description: r.description,
        merchant: r.evidence?.[0]?.extracted?.merchant ?? null,
        category: r.category?.name ?? "Uncategorized",
        villa: villaName.get(r.villa_id) ?? "",
        direction: r.direction,
        amount: Number(r.amount_reporting),
        original: r.currency !== org.reportingCurrency ? { amount: Number(r.amount), currency: r.currency } : null,
        receiptUrl: r.evidence?.[0] ? urlByPath.get(r.evidence[0].storage_path) ?? null : null,
      })),
      evidence: { expenses: expenses.length, withReceipt: expenses.filter((r) => r.evidence?.length).length },
      villas: org.villas.map((v) => {
        const rs = monthRows.filter((r) => r.villa_id === v.id);
        const income = rs.filter((r) => r.direction === "in").reduce((s, r) => s + Number(r.amount_reporting), 0);
        const exp = rs.filter((r) => r.direction === "out").reduce((s, r) => s + Number(r.amount_reporting), 0);
        return { id: v.id, name: v.name, income, expenses: exp, net: income - exp, closed: closedBy.has(v.id) ? { at: closedBy.get(v.id)! } : null };
      }),
      missingEvidence: (missing.data ?? []).map((m) => ({ ...m, amount: Number(m.amount) })),
      toReview: toReview.count ?? 0,
      toRead: toRead.count ?? 0,
    },
  };
}
