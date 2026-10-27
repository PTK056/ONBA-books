// Development-only preview of the overview with synthetic figures, no Supabase needed.

import { notFound } from "next/navigation";
import { OverviewView } from "@/components/overview/OverviewView";
import type { Overview } from "@/lib/overview/data";

const TREND = [
  ["2025-10", 0, 0], ["2025-11", 0, 0], ["2025-12", 0, 0], ["2026-01", 0, 0], ["2026-02", 0, 0],
  ["2026-03", 41_500_000, 9_800_000], ["2026-04", 38_200_000, 12_400_000], ["2026-05", 45_900_000, 11_100_000],
  ["2026-06", 52_300_000, 14_700_000], ["2026-07", 49_800_000, 10_200_000], ["2026-08", 36_100_000, 11_900_000],
  ["2026-09", 44_000_000, 13_400_000],
].map(([m, income, expenses]) => ({ month: `${m}-01`, income: +income, expenses: +expenses, net: +income - +expenses }));

const BOOKED = [0, 0, 0, 0, 0, 19, 17, 21, 25, 24, 16, 20];
const OCCUPANCY = TREND.map((t, i) => {
  const available = new Date(Date.UTC(+t.month.slice(0, 4), +t.month.slice(5, 7), 0)).getUTCDate();
  const booked = BOOKED[i];
  return {
    month: t.month, booked, available, stayIncome: t.income,
    occupancy: booked / available, adr: booked ? t.income / booked : null, revpar: t.income / available,
  };
});

const DATA: Overview = {
  org: { id: "dev", name: "Casa Demo", reportingCurrency: "IDR", role: "admin", fiscalYearStart: 1 },
  month: "2026-09-01",
  monthEnded: true,
  trend: TREND,
  totals: TREND[11],
  previous: TREND[10],
  occupancy: OCCUPANCY,
  categories: [
    { name: "Staff", amount: 6_500_000, count: 2, share: 0.485, monthlyAverage: 6_500_000 },
    { name: "Cleaning & laundry", amount: 2_900_000, count: 9, share: 0.216, monthlyAverage: 1_800_000 },
    { name: "Utilities", amount: 1_950_000, count: 3, share: 0.146, monthlyAverage: 2_100_000 },
    { name: "Guest supplies", amount: 1_420_000, count: 14, share: 0.106, monthlyAverage: 1_300_000 },
    { name: "Pool & garden", amount: 510_000, count: 2, share: 0.038, monthlyAverage: 600_000 },
    { name: "Other expenses", amount: 120_000, count: 1, share: 0.009, monthlyAverage: 0 },
  ],
  merchants: [
    { name: "Kamalis Laundry", amount: 391_000, count: 4 },
    { name: "Indomaret", amount: 128_300, count: 2 },
    { name: "Alfamart Munggu", amount: 74_800, count: 1 },
    { name: "Ngelinus Tropical", amount: 36_000, count: 1 },
  ],
  entries: [
    { id: "1", date: "2026-09-15", description: "Laundry: bed linen and towels", merchant: "Kamalis Laundry", category: "Cleaning & laundry", villa: "Villa One", direction: "out", amount: 68_000, original: null, receiptUrl: "#" },
    { id: "2", date: "2026-09-14", description: "Whole coconuts, 3 pcs", merchant: "Ngelinus Tropical", category: "Guest supplies", villa: "Villa One", direction: "out", amount: 36_000, original: null, receiptUrl: "#" },
    { id: "3", date: "2026-09-08", description: "Baygon insect sprays", merchant: "Alfamart Munggu", category: "Cleaning & laundry", villa: "Villa One", direction: "out", amount: 74_800, original: null, receiptUrl: "#" },
    { id: "4", date: "2026-09-05", description: "Staff salary, Kadek", merchant: null, category: "Staff", villa: "Villa One", direction: "out", amount: 3_250_000, original: null, receiptUrl: null },
    { id: "5", date: "2026-09-01", description: "Airbnb payout", merchant: null, category: "Accommodation", villa: "Villa One", direction: "in", amount: 44_000_000, original: { amount: 2_750, currency: "USD" }, receiptUrl: null },
  ],
  evidence: { expenses: 31, withReceipt: 29 },
  stays: [
    { key: "s1", code: "HMCCC", platform: "airbnb", guest: "Cleo", villa: "Villa One", checkIn: "2026-08-28", checkOut: "2026-09-05", nightsInMonth: 4, net: 7_677_817, upcoming: false },
    { key: "s2", code: "HMFYH", platform: "airbnb", guest: "Max", villa: "Villa One", checkIn: "2026-09-07", checkOut: "2026-09-11", nightsInMonth: 4, net: 5_766_035, upcoming: false },
    { key: "s3", code: "HM8PN", platform: "airbnb", guest: "Lea", villa: "Villa One", checkIn: "2026-09-13", checkOut: "2026-09-16", nightsInMonth: 3, net: 4_311_373, upcoming: false },
    { key: "s4", code: "HM535", platform: "airbnb", guest: "Tom", villa: "Villa One", checkIn: "2026-09-25", checkOut: "2026-09-29", nightsInMonth: 4, net: 2_139_976, upcoming: false },
  ],
  villas: [{ id: "00000000-0000-0000-0000-000000000001", name: "Villa One", income: 44_000_000, expenses: 13_400_000, net: 30_600_000, closed: null, booked: 20, available: 30, occupancy: 20 / 30, adr: 2_200_000 }],
  missingEvidence: [
    { id: "m1", date: "2026-09-05", description: "Staff salary, Kadek", amount: 3_250_000, currency: "IDR" },
    { id: "m2", date: "2026-09-20", description: "Gas refill", amount: 25_000, currency: "IDR" },
  ],
  toReview: 3,
  toRead: 0,
  company: { id: "co", name: "Company", income: 0, expenses: 26100, net: -26100, closed: null },
};

export default function DevOverview() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main className="flex flex-1 flex-col"><OverviewView data={DATA} /></main>;
}
