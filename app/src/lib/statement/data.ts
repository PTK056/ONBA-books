import "server-only";
import { createClient } from "@/lib/supabase/server";

const REFUNDED_SHARE = 0.05; // same rule as the overview: a refunded booking did not occupy the villa

export interface StatementStay {
  code: string;
  platform: string;
  guest: string | null;      // first name only
  checkIn: string;
  checkOut: string;
  nightsInMonth: number;
  nightsTotal: number;
  gross: number;             // reporting currency, this month's share
  fees: number;
  net: number;
}

export interface StatementLine {
  date: string;
  description: string | null;
  merchant: string | null;
  amount: number;            // reporting currency
  original: { amount: number; currency: string } | null;
  hasReceipt: boolean;
}

export interface Statement {
  org: { name: string; reportingCurrency: string };
  villa: { id: string; name: string };
  month: string;             // YYYY-MM-01
  closed: boolean;
  generatedAt: string;
  stays: StatementStay[];
  otherIncome: StatementLine[];
  expenses: { category: string; total: number; lines: StatementLine[] }[];
  totals: { stayIncome: number; otherIncome: number; platformFees: number; operating: number; net: number };
  occupancy: { booked: number; available: number; rate: number; adr: number | null; revpar: number };
  missingReceipts: number;
}

type Row = {
  date: string;
  direction: "in" | "out";
  source: string;
  amount: number;
  currency: string;
  amount_reporting: number;
  description: string | null;
  category: { name: string } | null;
  evidence: { extracted: { merchant?: string | null } | null }[];
  stay: { external_ref: string | null; platform: string; guest_name: string | null; check_in: string; check_out: string } | null;
};

const DAY = 86_400_000;
const nightsBetween = (a: number, b: number) => Math.max(0, Math.round((b - a) / DAY));

/** Everything validated for one villa and one month, grouped the way the PDF prints it. */
export async function loadStatement(villaId: string, month: string): Promise<Statement | null> {
  const db = await createClient();
  const { data: villa } = await db.from("villas")
    .select("id, name, organization_id, organizations (name, reporting_currency)").eq("id", villaId).maybeSingle();
  if (!villa) return null;
  const org = (villa as unknown as { organizations: { name: string; reporting_currency: string } }).organizations;

  const start = Date.parse(`${month}T00:00:00Z`);
  const endDate = new Date(start); endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const end = endDate.getTime();
  const to = endDate.toISOString().slice(0, 10);

  const [txs, close, stays] = await Promise.all([
    db.from("transactions")
      .select("date, direction, source, amount, currency, amount_reporting, description, category:categories (name), evidence (extracted), stay:stays (external_ref, platform, guest_name, check_in, check_out)")
      .eq("villa_id", villaId).eq("status", "validated").gte("date", month).lt("date", to).order("date"),
    db.from("month_closes").select("status").eq("villa_id", villaId).eq("month", month).maybeSingle(),
    db.from("stays").select("check_in, check_out, gross_amount, net_amount")
      .eq("villa_id", villaId).neq("status", "canceled").lt("check_in", to).gt("check_out", month),
  ]);
  const rows = (txs.data ?? []) as unknown as Row[];

  // Stays: this month's income and fee lines, one row per booking.
  const byStay = new Map<string, StatementStay>();
  for (const r of rows.filter((x) => x.source === "stay" && x.stay)) {
    const s = r.stay!;
    const key = `${s.platform}:${s.external_ref}`;
    const inStart = Math.max(start, Date.parse(`${s.check_in}T00:00:00Z`));
    const inEnd = Math.min(end, Date.parse(`${s.check_out}T00:00:00Z`));
    const row = byStay.get(key) ?? {
      code: s.external_ref ?? "-",
      platform: s.platform,
      guest: s.guest_name?.split(/\s+/)[0] ?? null,
      checkIn: s.check_in,
      checkOut: s.check_out,
      nightsInMonth: nightsBetween(inStart, inEnd),
      nightsTotal: nightsBetween(Date.parse(`${s.check_in}T00:00:00Z`), Date.parse(`${s.check_out}T00:00:00Z`)),
      gross: 0, fees: 0, net: 0,
    };
    if (r.direction === "in") row.gross += Number(r.amount_reporting); else row.fees += Number(r.amount_reporting);
    row.net = row.gross - row.fees;
    byStay.set(key, row);
  }

  const line = (r: Row): StatementLine => ({
    date: r.date,
    description: r.description,
    merchant: r.evidence?.[0]?.extracted?.merchant ?? null,
    amount: Number(r.amount_reporting),
    original: r.currency !== org.reporting_currency ? { amount: Number(r.amount), currency: r.currency } : null,
    hasReceipt: r.evidence?.length > 0,
  });
  const others = rows.filter((r) => r.source !== "stay");
  const otherIncome = others.filter((r) => r.direction === "in").map(line);
  const groups = new Map<string, StatementLine[]>();
  for (const r of others.filter((x) => x.direction === "out")) {
    const name = r.category?.name ?? "Uncategorized";
    groups.set(name, [...(groups.get(name) ?? []), line(r)]);
  }
  const expenses = [...groups]
    .map(([category, lines]) => ({ category, lines, total: lines.reduce((s, l) => s + l.amount, 0) }))
    .sort((a, b) => b.total - a.total);

  const stayRows = [...byStay.values()].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const stayIncome = stayRows.reduce((s, x) => s + x.gross, 0);
  const platformFees = stayRows.reduce((s, x) => s + x.fees, 0);
  const otherTotal = otherIncome.reduce((s, l) => s + l.amount, 0);
  const operating = expenses.reduce((s, g) => s + g.total, 0);

  let booked = 0;
  for (const s of stays.data ?? []) {
    if (Number(s.net_amount) <= REFUNDED_SHARE * Number(s.gross_amount)) continue;
    booked += nightsBetween(Math.max(start, Date.parse(`${s.check_in}T00:00:00Z`)), Math.min(end, Date.parse(`${s.check_out}T00:00:00Z`)));
  }
  const available = nightsBetween(start, end);

  return {
    org: { name: org.name, reportingCurrency: org.reporting_currency },
    villa: { id: villa.id, name: villa.name },
    month,
    closed: close.data?.status === "closed",
    generatedAt: new Date().toISOString(),
    stays: stayRows,
    otherIncome,
    expenses,
    totals: { stayIncome, otherIncome: otherTotal, platformFees, operating, net: stayIncome + otherTotal - platformFees - operating },
    occupancy: {
      booked, available,
      rate: available ? Math.min(1, booked / available) : 0,
      adr: booked ? stayIncome / booked : null,
      revpar: available ? stayIncome / available : 0,
    },
    missingReceipts: expenses.flatMap((g) => g.lines).filter((l) => !l.hasReceipt).length,
  };
}
