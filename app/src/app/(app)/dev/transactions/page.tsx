// Development-only preview of the Transactions page with synthetic entries, no Supabase needed.
// Filtering does nothing here: the form only reloads the same rows.

import { notFound } from "next/navigation";
import { TransactionsView } from "@/components/transactions/TransactionsView";
import type { Tx } from "@/lib/transactions/data";

const VILLA = { id: "v1", name: "Villa One" };
const tx = (t: Partial<Tx> & Pick<Tx, "id" | "date" | "direction" | "amount">): Tx => ({
  source: "receipt", description: null, merchant: null, category: null, villa: VILLA, currency: "IDR", fxRate: 1,
  amountReporting: t.amount, stayCode: null, files: [{ id: `f${t.id}`, path: "", mime: "image/jpeg" }], splitGroup: null, ...t,
} as Tx);

const ROWS: Tx[] = [
  tx({ id: "1", date: "2026-09-29", direction: "in", amount: 2_139_976, source: "stay", description: "Stay of Tom", category: { id: "c0", name: "Accommodation" }, files: [] }),
  tx({ id: "2", date: "2026-09-25", direction: "out", amount: 3_250_000, source: "manual", description: "Staff salary, Kadek", category: { id: "c1", name: "Staff" }, files: [] }),
  tx({ id: "3", date: "2026-09-21", direction: "out", amount: 1_950_000, source: "module", description: "Electricity", merchant: "PLN", category: { id: "c2", name: "Utilities" } }),
  tx({ id: "4", date: "2026-09-15", direction: "out", amount: 68_000, description: "Laundry: bed linen and towels", merchant: "Kamalis Laundry", category: { id: "c3", name: "Cleaning & laundry" } }),
  tx({ id: "5", date: "2026-09-14", direction: "out", amount: 36_000, description: "Whole coconuts, 3 pcs", merchant: "Ngelinus Tropical", category: { id: "c4", name: "Guest supplies" } }),
  tx({ id: "6", date: "2026-09-10", direction: "out", amount: 600_000, source: "manual", description: "Pool maintenance", merchant: "Pool Care Bali", category: { id: "c5", name: "Pool & garden" }, files: [] }),
  tx({ id: "7", date: "2026-09-08", direction: "out", amount: 74_800, description: "Baygon insect sprays", merchant: "Alfamart Munggu", category: { id: "c3", name: "Cleaning & laundry" } }),
  tx({ id: "8", date: "2026-09-01", direction: "in", amount: 44_000_000, source: "stay", description: "Airbnb payout", category: { id: "c0", name: "Accommodation" },
    currency: "USD", fxRate: 16_000, files: [] }),
].map((t) => (t.currency === "USD" ? { ...t, amountReporting: t.amount, amount: 2_750 } : t));

export default function DevTransactions() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-8">
      <TransactionsView
        filters={{}} rows={ROWS} truncated={false} villa={null} places={[VILLA]} showVilla={false} editor currency="IDR"
        categories={[{ id: "c0", name: "Accommodation" }, { id: "c1", name: "Staff" }, { id: "c2", name: "Utilities" }, { id: "c3", name: "Cleaning & laundry" }]}
      />
    </main>
  );
}
