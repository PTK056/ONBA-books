// Development-only: the statement PDF with synthetic figures, no Supabase needed.

import type { Statement } from "@/lib/statement/data";
import { renderStatement } from "@/lib/statement/render";

const EXPENSES: Statement["expenses"] = [
  { category: "Staff", total: 6_500_000, lines: [
    { date: "2026-09-05", description: "Salary, housekeeper", merchant: null, amount: 3_250_000, original: null, hasReceipt: false },
    { date: "2026-09-05", description: "Salary, gardener", merchant: null, amount: 3_250_000, original: null, hasReceipt: true },
  ] },
  { category: "Cleaning & laundry", total: 391_000, lines: [
    { date: "2026-09-06", description: "Laundry: bed linen and towels", merchant: "Kamalis Laundry", amount: 132_000, original: null, hasReceipt: true },
    { date: "2026-09-11", description: "Laundry: towels", merchant: "Kamalis Laundry", amount: 70_000, original: null, hasReceipt: true },
    { date: "2026-09-13", description: "Laundry: bed linen", merchant: "Kamalis Laundry", amount: 121_000, original: null, hasReceipt: true },
    { date: "2026-09-15", description: "Laundry: towels", merchant: "Kamalis Laundry", amount: 68_000, original: null, hasReceipt: true },
  ] },
  { category: "Guest supplies", total: 165_500, lines: [
    { date: "2026-09-03", description: "Drinking water, 3 gallons", merchant: null, amount: 60_000, original: null, hasReceipt: true },
    { date: "2026-09-08", description: "Toilet paper, soap", merchant: "Indomaret Munggu", amount: 58_200, original: null, hasReceipt: true },
    { date: "2026-09-14", description: "Whole coconuts, 3 pcs", merchant: "Ngelinus Tropical", amount: 36_000, original: null, hasReceipt: true },
    { date: "2026-09-20", description: "Welcome snacks", merchant: null, amount: 11_300, original: { amount: 0.7, currency: "USD" }, hasReceipt: false },
  ] },
];

const ST: Statement = {
  org: { name: "Casa Demo", reportingCurrency: "IDR" },
  villa: { id: "dev", name: "Villa One" },
  month: "2026-09-01",
  closed: false,
  generatedAt: new Date().toISOString(),
  stays: [
    { code: "HMCCC", platform: "airbnb", guest: "Cleo", checkIn: "2026-08-28", checkOut: "2026-09-05", nightsInMonth: 4, nightsTotal: 8, gross: 9_255_870, fees: 1_578_053, net: 7_677_817 },
    { code: "HMFYH", platform: "airbnb", guest: "Max", checkIn: "2026-09-07", checkOut: "2026-09-11", nightsInMonth: 4, nightsTotal: 4, gross: 6_951_300, fees: 1_185_265, net: 5_766_035 },
    { code: "HM8PN", platform: "airbnb", guest: "Lea", checkIn: "2026-09-13", checkOut: "2026-09-16", nightsInMonth: 3, nightsTotal: 3, gross: 5_197_626, fees: 886_253, net: 4_311_373 },
    { code: "HM535", platform: "airbnb", guest: "Tom", checkIn: "2026-09-25", checkOut: "2026-09-29", nightsInMonth: 4, nightsTotal: 4, gross: 2_579_877, fees: 439_901, net: 2_139_976 },
  ],
  otherIncome: [],
  expenses: EXPENSES,
  totals: { stayIncome: 23_984_673, otherIncome: 0, platformFees: 4_089_472, operating: 7_056_500, net: 12_838_701 },
  occupancy: { booked: 15, available: 30, rate: 0.5, adr: 1_598_978, revpar: 799_489 },
  missingReceipts: 2,
};

export async function GET() {
  if (process.env.NODE_ENV !== "development") return new Response("Not found", { status: 404 });
  const pdf = await renderStatement({ ...ST, generatedAt: new Date().toISOString() });
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf" } });
}
