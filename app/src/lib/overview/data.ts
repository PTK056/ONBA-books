import "server-only";
import { connection } from "next/server";
import { todayIn } from "@/lib/format/date";
import { availableNights, openingDays } from "./availability";
import { getCurrentOrg, places, scopedOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export const TREND_MONTHS = 12;
const MAX_ENTRIES = 5000; // 12 months of validated entries; far above a villa's volume
const SIGNED_URL_TTL = 60 * 60;
const REFUNDED_SHARE = 0.05; // net under 5% of gross: treated as refunded for occupancy

export interface MonthTotals { month: string; income: number; expenses: number; net: number }

/** Nights booked vs available, and income from stays, for one month. */
export interface MonthOccupancy {
  month: string;
  booked: number;
  available: number;
  stayIncome: number;     // reporting currency, from imported stays only
  occupancy: number;      // booked / available, 0..1
  adr: number | null;     // average daily rate: stay income per booked night
  revpar: number;         // stay income per available night
}

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
  booked: number;
  available: number;
  occupancy: number;
  adr: number | null;
}

/** A booking with nights in the month shown, and what this month gets from it. */
export interface MonthStay {
  key: string;
  code: string;
  platform: string;
  guest: string | null;      // first name only
  villa: string;
  checkIn: string;
  checkOut: string;
  nightsInMonth: number;
  net: number;               // this month's share, reporting currency
  upcoming: boolean;         // arrives after today
}

export interface Overview {
  org: { id: string; name: string; reportingCurrency: string; role: "admin" | "staff" | "owner_viewer"; fiscalYearStart: number };
  month: string;
  monthEnded: boolean;                  // the month shown is over (closing it makes sense)
  trend: MonthTotals[];
  totals: MonthTotals;
  previous: MonthTotals;
  occupancy: MonthOccupancy[];          // same months as `trend`
  categories: CategoryLine[];
  merchants: { name: string; amount: number; count: number }[];
  entries: Entry[];
  stays: MonthStay[];
  evidence: { expenses: number; withReceipt: number };
  villas: VillaMonth[];
  /** What belongs to no villa this month (bank fees, accountant…); null when the company has nothing and no close to show. */
  company: Pick<VillaMonth, "id" | "name" | "income" | "expenses" | "net" | "closed"> | null;
  missingEvidence: { id: string; date: string; description: string | null; amount: number; currency: string }[];
  toReview: number;
  toRead: number;
}

export type OverviewResult =
  | { kind: "signed_out" }
  | { kind: "no_organization" }
  | { kind: "ready"; data: Overview };

const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const iso = (d: Date) => d.toISOString().slice(0, 10);

type Row = {
  id: string;
  source: string;
  stay_id: string | null;
  stay: { external_ref: string | null; platform: string; guest_name: string | null; check_in: string; check_out: string } | null;
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

/** Figures for one month (default: the current month in the organization's time zone) and the 12 months up to it. */
export async function loadOverview(requested?: string): Promise<OverviewResult> {
  await connection();
  const full = await getCurrentOrg();
  if (full.kind === "signed_out") return { kind: "signed_out" };
  if (full.kind === "none") return { kind: "no_organization" };
  // The villa chosen in the sidebar, if any: everything below is about it alone.
  const { org, scope } = await scopedOrg(full);
  const db = await createClient();

  let month: Date;
  if (requested && /^\d{4}-\d{2}$/.test(requested)) {
    month = new Date(`${requested}-01T00:00:00Z`);
  } else {
    // Not the latest month with entries: prepaid costs (a lease spread ahead) would open a future month.
    const { data: o } = await db.from("organizations").select("timezone").eq("id", org.id).single();
    month = new Date(`${todayIn(o?.timezone ?? "UTC").slice(0, 7)}-01T00:00:00Z`);
  }
  const from = iso(month);
  const to = iso(addMonths(month, 1));
  const windowFrom = iso(addMonths(month, -(TREND_MONTHS - 1)));

  let txQuery = db.from("transactions")
    .select("id, date, direction, source, amount, currency, amount_reporting, description, villa_id, category:categories (name), evidence (storage_path, extracted), stay_id, stay:stays (external_ref, platform, guest_name, check_in, check_out)")
    .eq("organization_id", org.id).eq("status", "validated")
    .gte("date", windowFrom).lt("date", to)
    .order("date", { ascending: false }).limit(MAX_ENTRIES);
  if (scope) txQuery = txQuery.in("villa_id", scope);
  let missingQuery = db.from("expenses_missing_evidence").select("id, date, description, amount, currency")
    .eq("organization_id", org.id).gte("date", from).lt("date", to).order("date");
  if (scope) missingQuery = missingQuery.in("villa_id", scope);
  let staysQuery = db.from("stays").select("villa_id, check_in, check_out, gross_amount, net_amount")
    .eq("organization_id", org.id).neq("status", "canceled").lt("check_in", to).gt("check_out", windowFrom).limit(MAX_ENTRIES);
  if (scope) staysQuery = staysQuery.in("villa_id", scope);
  const [orgRow, txs, missing, closes, toReview, toRead, stays] = await Promise.all([
    db.from("organizations").select("fiscal_year_start").eq("id", org.id).single(),
    txQuery,
    missingQuery,
    db.from("month_closes").select("villa_id, status, closed_at")
      .eq("organization_id", org.id).eq("month", from),
    db.from("receipt_items").select("id", { count: "exact", head: true })
      .eq("organization_id", org.id).eq("status", "pending").not("read_at", "is", null),
    db.from("receipt_items").select("id", { count: "exact", head: true })
      .eq("organization_id", org.id).eq("status", "pending").is("read_at", null),
    staysQuery,
  ]);
  const rows = (txs.data ?? []) as unknown as Row[];
  const villaName = new Map(places(org).map((v) => [v.id, v.name]));

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

  // Occupancy: a night belongs to the month it starts in; available = days each villa was on the market.
  const opened = await openingDays(db, org.id);
  const bookedBy = new Map<string, number>();          // "YYYY-MM-01" or "YYYY-MM-01|villa"
  for (const st of stays.data ?? []) {
    // A booking refunded to the guest (net close to nothing) did not occupy the villa.
    if (Number(st.net_amount) <= REFUNDED_SHARE * Number(st.gross_amount)) continue;
    for (let d = Date.parse(`${st.check_in}T00:00:00Z`); d < Date.parse(`${st.check_out}T00:00:00Z`); d += 86_400_000) {
      const m = `${new Date(d).toISOString().slice(0, 7)}-01`;
      if (!byMonth.has(m)) continue;
      bookedBy.set(m, (bookedBy.get(m) ?? 0) + 1);
      bookedBy.set(`${m}|${st.villa_id}`, (bookedBy.get(`${m}|${st.villa_id}`) ?? 0) + 1);
    }
  }
  const stayIncomeBy = new Map<string, number>();
  for (const r of rows) {
    if (r.source !== "stay" || r.direction !== "in") continue;
    const m = `${r.date.slice(0, 7)}-01`;
    stayIncomeBy.set(m, (stayIncomeBy.get(m) ?? 0) + Number(r.amount_reporting));
    stayIncomeBy.set(`${m}|${r.villa_id}`, (stayIncomeBy.get(`${m}|${r.villa_id}`) ?? 0) + Number(r.amount_reporting));
  }
  const occupancyFor = (m: string, villaIds: string[], key = m): MonthOccupancy => {
    const booked = bookedBy.get(key) ?? 0;
    const available = villaIds.reduce((s, id) => s + availableNights(m, opened.get(id)), 0);
    const stayIncome = stayIncomeBy.get(key) ?? 0;
    return {
      month: m, booked, available, stayIncome,
      occupancy: available ? Math.min(1, booked / available) : 0,
      adr: booked ? stayIncome / booked : null,
      revpar: available ? stayIncome / available : 0,
    };
  };
  const villaIds = org.villas.map((v) => v.id);
  const occupancy = trend.map((t) => occupancyFor(t.month, villaIds));
  const previous = trend[trend.length - 2];

  const fyStart = orgRow.data?.fiscal_year_start ?? 1;

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
      monthEnded: from < `${new Date().toISOString().slice(0, 7)}-01`,
      trend,
      totals,
      previous,
      occupancy,
      categories,
      merchants: [...merchants].map(([name, m]) => ({ name, ...m })).sort((a, b) => b.amount - a.amount).slice(0, 6),
      stays: (() => {
        const today = new Date().toISOString().slice(0, 10);
        const DAY = 86_400_000;
        const by = new Map<string, MonthStay>();
        for (const r of monthRows) {
          if (r.source !== "stay" || !r.stay || !r.stay_id) continue;
          const st = r.stay;
          const inStart = Math.max(Date.parse(`${from}T00:00:00Z`), Date.parse(`${st.check_in}T00:00:00Z`));
          const inEnd = Math.min(Date.parse(`${to}T00:00:00Z`), Date.parse(`${st.check_out}T00:00:00Z`));
          const m = by.get(r.stay_id) ?? {
            key: r.stay_id, code: st.external_ref ?? "-", platform: st.platform,
            guest: st.guest_name?.split(/\s+/)[0] ?? null, villa: villaName.get(r.villa_id) ?? "",
            checkIn: st.check_in, checkOut: st.check_out,
            nightsInMonth: Math.max(0, Math.round((inEnd - inStart) / DAY)),
            net: 0, upcoming: st.check_in > today,
          };
          m.net += (r.direction === "in" ? 1 : -1) * Number(r.amount_reporting);
          by.set(r.stay_id, m);
        }
        return [...by.values()].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
      })(),
      entries: monthRows.filter((r) => r.source !== "stay").map((r) => ({
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
        const occ = occupancyFor(from, [v.id], `${from}|${v.id}`);
        return {
          id: v.id, name: v.name, income, expenses: exp, net: income - exp,
          closed: closedBy.has(v.id) ? { at: closedBy.get(v.id)! } : null,
          booked: occ.booked, available: occ.available, occupancy: occ.occupancy, adr: occ.adr,
        };
      }),
      company: (() => {
        if (!org.company) return null;
        const rs = monthRows.filter((r) => r.villa_id === org.company!.id);
        const income = rs.filter((r) => r.direction === "in").reduce((s, r) => s + Number(r.amount_reporting), 0);
        const exp = rs.filter((r) => r.direction === "out").reduce((s, r) => s + Number(r.amount_reporting), 0);
        return {
          id: org.company.id, name: org.company.name, income, expenses: exp, net: income - exp,
          closed: closedBy.has(org.company.id) ? { at: closedBy.get(org.company.id)! } : null,
        };
      })(),
      missingEvidence: (missing.data ?? []).map((m) => ({ ...m, amount: Number(m.amount) })),
      toReview: toReview.count ?? 0,
      toRead: toRead.count ?? 0,
    },
  };
}
