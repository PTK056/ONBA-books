import "server-only";
import { connection } from "next/server";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import type { CategoryLine, MonthOccupancy, MonthTotals } from "./data";

const MAX_ROWS = 20000;
const REFUNDED_SHARE = 0.05; // same rule as the month view
const DAY = 86_400_000;

/** One bucket of the period: a month (year view) or a year (all-time view). */
export interface Bucket extends MonthTotals, Omit<MonthOccupancy, "month"> {
  label: string;
  href: string;              // opens that month or year
}

export interface PeriodOverview {
  kind: "year" | "all";
  year: string | null;
  years: string[];           // years with entries, newest first (for the year switcher)
  org: { id: string; name: string; reportingCurrency: string; role: "admin" | "staff" | "owner_viewer" };
  villaCount: number;
  totals: { income: number; expenses: number; net: number; platformFees: number };
  occupancy: { booked: number; available: number; rate: number; adr: number | null; revpar: number };
  buckets: Bucket[];
  categories: CategoryLine[];
  merchants: { name: string; amount: number; count: number }[];
  stays: { count: number; nights: number; averageLength: number | null; bestBucket: Bucket | null };
  missingReceipts: number;
  toReview: number;
  toRead: number;
}

type Row = {
  date: string; direction: "in" | "out"; source: string; amount_reporting: number; villa_id: string;
  category: { name: string } | null; evidence: { extracted: { merchant?: string | null } | null }[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

export async function loadPeriod(kind: "year" | "all", requestedYear?: string): Promise<
  { kind: "signed_out" } | { kind: "no_organization" } | { kind: "ready"; data: PeriodOverview }
> {
  await connection();
  const org = await getCurrentOrg();
  if (org.kind === "signed_out") return { kind: "signed_out" };
  if (org.kind === "none") return { kind: "no_organization" };
  const db = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);

  // Years that have entries, for the switcher and the default year.
  const [{ data: first }, { data: last }] = await Promise.all([
    db.from("transactions").select("date").eq("organization_id", org.id).eq("status", "validated").order("date").limit(1),
    db.from("transactions").select("date").eq("organization_id", org.id).eq("status", "validated").order("date", { ascending: false }).limit(1),
  ]);
  const firstYear = first?.[0]?.date.slice(0, 4) ?? today.slice(0, 4);
  const lastYear = last?.[0]?.date.slice(0, 4) ?? today.slice(0, 4);
  const years: string[] = [];
  for (let y = +lastYear; y >= +firstYear; y--) years.push(String(y));
  const year = kind === "year" ? (requestedYear && /^\d{4}$/.test(requestedYear) ? requestedYear : lastYear) : null;

  const from = year ? `${year}-01-01` : `${firstYear}-01-01`;
  const to = year ? `${+year + 1}-01-01` : `${+lastYear + 1}-01-01`;

  const [txs, stays, missing, toReview, toRead] = await Promise.all([
    db.from("transactions")
      .select("date, direction, source, amount_reporting, villa_id, category:categories (name), evidence (extracted)")
      .eq("organization_id", org.id).eq("status", "validated").gte("date", from).lt("date", to).limit(MAX_ROWS),
    db.from("stays").select("check_in, check_out, gross_amount, net_amount")
      .eq("organization_id", org.id).lt("check_in", to).gt("check_out", from).limit(MAX_ROWS),
    db.from("expenses_missing_evidence").select("id", { count: "exact", head: true })
      .eq("organization_id", org.id).gte("date", from).lt("date", to),
    db.from("receipt_items").select("id", { count: "exact", head: true })
      .eq("organization_id", org.id).eq("status", "pending").not("read_at", "is", null),
    db.from("receipt_items").select("id", { count: "exact", head: true })
      .eq("organization_id", org.id).eq("status", "pending").is("read_at", null),
  ]);
  const rows = (txs.data ?? []) as unknown as Row[];
  const villaCount = Math.max(1, org.villas.length);

  // Buckets: the 12 months of the year, or one per year for all time.
  const keyOf = (date: string) => (year ? date.slice(0, 7) : date.slice(0, 4));
  const bucketKeys = year
    ? MONTHS.map((_, i) => `${year}-${String(i + 1).padStart(2, "0")}`)
    : [...years].reverse();
  const buckets = new Map<string, Bucket>(bucketKeys.map((k) => {
    // Nights available: whole months up to the current one (the future can't be occupied yet).
    let available = 0;
    const months = year ? [k] : MONTHS.map((_, i) => `${k}-${String(i + 1).padStart(2, "0")}`);
    for (const m of months) if (m <= thisMonth) available += daysInMonth(+m.slice(0, 4), +m.slice(5, 7) - 1) * villaCount;
    return [k, {
      month: year ? `${k}-01` : `${k}-01-01`,
      label: year ? MONTHS[+k.slice(5, 7) - 1] : k,
      href: year ? `/overview?month=${k}` : `/overview?view=year&year=${k}`,
      income: 0, expenses: 0, net: 0,
      booked: 0, available, stayIncome: 0, occupancy: 0, adr: null, revpar: 0,
    }];
  }));

  let platformFees = 0;
  const categories = new Map<string, { amount: number; count: number }>();
  const merchants = new Map<string, { amount: number; count: number }>();
  for (const r of rows) {
    const b = buckets.get(keyOf(r.date));
    if (!b) continue;
    const amt = Number(r.amount_reporting);
    if (r.direction === "in") {
      b.income += amt;
      if (r.source === "stay") b.stayIncome += amt;
    } else {
      b.expenses += amt;
      if (r.source === "stay") platformFees += amt;
      const name = r.category?.name ?? "Uncategorized";
      const c = categories.get(name) ?? { amount: 0, count: 0 };
      c.amount += amt; c.count++;
      categories.set(name, c);
      const merchant = r.evidence?.[0]?.extracted?.merchant?.trim();
      if (merchant) {
        const m = merchants.get(merchant) ?? { amount: 0, count: 0 };
        m.amount += amt; m.count++;
        merchants.set(merchant, m);
      }
    }
  }

  let stayCount = 0;
  let stayNights = 0;
  for (const st of stays.data ?? []) {
    if (Number(st.net_amount) <= REFUNDED_SHARE * Number(st.gross_amount)) continue;
    let counted = false;
    for (let d = Date.parse(`${st.check_in}T00:00:00Z`); d < Date.parse(`${st.check_out}T00:00:00Z`); d += DAY) {
      const day = new Date(d).toISOString().slice(0, 10);
      const b = buckets.get(keyOf(day));
      if (!b || day < from || day >= to) continue;
      b.booked++;
      stayNights++;
      counted = true;
    }
    if (counted) stayCount++;
  }

  for (const b of buckets.values()) {
    b.net = b.income - b.expenses;
    b.occupancy = b.available ? Math.min(1, b.booked / b.available) : 0;
    b.adr = b.booked ? b.stayIncome / b.booked : null;
    b.revpar = b.available ? b.stayIncome / b.available : 0;
  }
  const list = [...buckets.values()];
  const income = list.reduce((s, b) => s + b.income, 0);
  const expenses = list.reduce((s, b) => s + b.expenses, 0);
  const booked = list.reduce((s, b) => s + b.booked, 0);
  const available = list.reduce((s, b) => s + b.available, 0);
  const stayIncome = list.reduce((s, b) => s + b.stayIncome, 0);
  const withEntries = list.filter((b) => b.income || b.expenses);

  return {
    kind: "ready",
    data: {
      kind, year, years,
      org: { id: org.id, name: org.name, reportingCurrency: org.reportingCurrency, role: org.role },
      villaCount,
      totals: { income, expenses, net: income - expenses, platformFees },
      occupancy: {
        booked, available,
        rate: available ? Math.min(1, booked / available) : 0,
        adr: booked ? stayIncome / booked : null,
        revpar: available ? stayIncome / available : 0,
      },
      buckets: list,
      categories: [...categories]
        .map(([name, c]) => ({ name, ...c, share: expenses ? c.amount / expenses : 0, monthlyAverage: 0 }))
        .sort((a, b) => b.amount - a.amount),
      merchants: [...merchants].map(([name, m]) => ({ name, ...m })).sort((a, b) => b.amount - a.amount).slice(0, 8),
      stays: {
        count: stayCount,
        nights: stayNights,
        averageLength: stayCount ? stayNights / stayCount : null,
        bestBucket: withEntries.length ? withEntries.reduce((a, b) => (b.net > a.net ? b : a)) : null,
      },
      missingReceipts: missing.count ?? 0,
      toReview: toReview.count ?? 0,
      toRead: toRead.count ?? 0,
    },
  };
}
