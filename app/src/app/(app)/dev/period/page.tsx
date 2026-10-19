// Development-only preview of the year view with synthetic figures.

import { notFound } from "next/navigation";
import { PeriodView } from "@/components/overview/PeriodView";
import type { Bucket, PeriodOverview } from "@/lib/overview/period";

const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const INCOME = [11.3, 32.8, 18.6, 0, 14.4, 30.9, 35.6, 51.1, 30.6, 0, 0, 0].map((x) => x * 1e6);
const EXPENSES = [0.4, 1.1, 0.6, 0, 0.5, 1.2, 1.3, 8.7, 6.1, 0, 0, 0].map((x) => x * 1e6);
const BOOKED = [11, 25, 14, 0, 11, 21, 24, 24, 20, 0, 0, 0];
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const buckets: Bucket[] = M.map((label, i) => {
  const available = i <= 9 ? DAYS[i] : 0;
  return {
    month: `2026-${String(i + 1).padStart(2, "0")}-01`, label, href: `/dev/overview`,
    income: INCOME[i], expenses: EXPENSES[i], net: INCOME[i] - EXPENSES[i],
    booked: BOOKED[i], available, stayIncome: INCOME[i],
    occupancy: available ? BOOKED[i] / available : 0, adr: BOOKED[i] ? INCOME[i] / BOOKED[i] : null,
    revpar: available ? INCOME[i] / available : 0,
  };
});
const sum = (k: "income" | "expenses" | "booked" | "available") => buckets.reduce((s, b) => s + b[k], 0);

const DATA: PeriodOverview = {
  kind: "year", year: "2026", years: ["2026", "2025"],
  org: { id: "dev", name: "Casa Demo", reportingCurrency: "IDR", role: "admin" },
  villaCount: 1,
  totals: { income: sum("income"), expenses: sum("expenses"), net: sum("income") - sum("expenses"), platformFees: 17_400_000 },
  occupancy: { booked: sum("booked"), available: sum("available"), rate: sum("booked") / sum("available"), adr: sum("income") / sum("booked"), revpar: sum("income") / sum("available") },
  buckets,
  categories: [
    { name: "Platform fees", amount: 17_400_000, count: 38, share: 0.87, monthlyAverage: 0 },
    { name: "Cleaning & laundry", amount: 1_400_000, count: 12, share: 0.07, monthlyAverage: 0 },
    { name: "Guest supplies", amount: 1_200_000, count: 23, share: 0.06, monthlyAverage: 0 },
  ],
  merchants: [{ name: "Kamalis Laundry", amount: 391_000, count: 4 }, { name: "Indomaret", amount: 128_300, count: 2 }],
  stays: { count: 33, nights: sum("booked"), averageLength: sum("booked") / 33, bestBucket: buckets[7] },
  missingReceipts: 1, toReview: 0, toRead: 0,
};

export default function DevPeriod() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main className="flex flex-1 flex-col"><PeriodView data={DATA} /></main>;
}
