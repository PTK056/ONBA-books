// Development-only preview of the Bank page with synthetic statements and lines, no Supabase needed.
// The buttons call the real server actions, so they fail here: this is for looking only.

import { notFound } from "next/navigation";
import { BankView } from "@/components/bank/BankView";
import { PageHeader } from "@/components/shell/PageHeader";
import type { BankLineRow } from "@/lib/bank/data";
import type { ProposalView } from "@/lib/bank/accountant/render";

const line = (l: Partial<BankLineRow> & Pick<BankLineRow, "id" | "date" | "direction" | "amount" | "description">): BankLineRow => ({
  statementId: "s1", account: "BCA ••••4821", currency: "IDR", counterparty: null, status: "unmatched", matchedBy: null,
  handledVia: null, note: null, personalReason: null, linkedTo: null, proposal: null, suggestions: [], template: null, stays: [], known: null, ...l,
});

const proposal = (over: Partial<ProposalView> & Pick<ProposalView, "id" | "action" | "line">): ProposalView => ({
  runId: "r1", lineId: over.id, status: "pending", confidence: "high", why: "", question: null, outcome: null, amountDiffers: false,
  villa: null, category: null, description: null, entry: null, stays: [], personalReason: null, statementId: "s1", telegram: [], ...over,
});

const LINES: BankLineRow[] = [
  line({ id: "1", date: "2026-09-25", direction: "out", amount: 3_250_000, description: "TRSF E-BANKING DB 2509/FTSCY/WS95031 KADEK", counterparty: "Kadek Ayu",
    suggestions: [{ id: "t1", date: "2026-09-25", description: "Staff salary, Kadek", category: "Staff" }] }),
  line({ id: "2", date: "2026-09-21", direction: "out", amount: 1_950_000, description: "PLN POSTPAID 5321 0098 7712", counterparty: "PLN",
    known: { villaId: "v1", villa: "Villa One", categoryId: "c1", category: "Utilities", description: "Electricity", uses: 6 },
    proposal: proposal({ id: "p2", action: "add", villa: "Villa One", category: "Utilities", description: "Electricity",
      why: "Booked like the last 6 payments to PLN.",
      line: { date: "2026-09-21", direction: "out", amount: 1_950_000, currency: "IDR", counterparty: "PLN", description: "PLN POSTPAID" } }) }),
  line({ id: "3", date: "2026-09-18", direction: "in", amount: 12_400_000, description: "TRSF E-BANKING CR AIRBNB PAYMENTS", counterparty: "Airbnb Payments",
    stays: [{ id: "x1", guest: "Lea", platform: "airbnb", checkIn: "2026-09-13", checkOut: "2026-09-16" }] }),
  line({ id: "4", date: "2026-09-12", direction: "out", amount: 450_000, description: "BIAYA ADM / INTERNET BANKING", counterparty: null }),
  line({ id: "5", date: "2026-09-10", direction: "out", amount: 600_000, description: "TRSF E-BANKING DB POOL CARE BALI", counterparty: "Pool Care Bali",
    template: { fromId: "t9", fromDate: "2026-08-10", villaId: "v1", categoryId: "c2", category: "Pool & garden", description: "Pool maintenance" } }),
  line({ id: "6", date: "2026-09-04", direction: "out", amount: 2_000_000, description: "TARIKAN ATM 04/09", counterparty: null,
    proposal: proposal({ id: "p6", action: "ask", confidence: "low", question: "What was the 2,000,000 IDR cash withdrawal of 04/09 for?",
      line: { date: "2026-09-04", direction: "out", amount: 2_000_000, currency: "IDR", counterparty: null, description: "TARIKAN ATM 04/09" } }) }),
  line({ id: "7", date: "2026-09-02", direction: "out", amount: 68_000, description: "QRIS KAMALIS LAUNDRY", counterparty: "Kamalis Laundry", status: "matched", matchedBy: "auto", linkedTo: "Laundry: bed linen and towels" }),
  line({ id: "8", date: "2026-09-01", direction: "in", amount: 44_000_000, description: "TRSF CR AIRBNB", counterparty: "Airbnb Payments", status: "matched", matchedBy: "manual", linkedTo: "Airbnb payout",
    handledVia: "agent", note: "Payout for HM4KX and HM9QP" }),
  line({ id: "9", date: "2026-09-03", direction: "out", amount: 350_000, description: "TOKOPEDIA", counterparty: "Tokopedia", status: "personal",
    handledVia: "agent", personalReason: "private_expense", note: "Personal shopping on the company card" }),
];

export default function DevBank() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-8">
      <PageHeader title="Bank" description="Add your bank statements: what is at the bank but not in your books shows up here. Admins only." />
      <BankView
        organizationId="dev" reportingCurrency="IDR" chargesTo="the villa"
        villas={[{ id: "v1", name: "Villa One" }]}
        categories={[{ id: "c1", name: "Utilities", kind: "expense" }, { id: "c2", name: "Pool & garden", kind: "expense" }, { id: "c3", name: "Accommodation", kind: "income" }]}
        statements={[
          { id: "s1", account: "BCA ••••4821", periodStart: "2026-09-01", periodEnd: "2026-09-30", linesAdded: 42, linesSkipped: 0, balanced: true, notes: "Two lines on page 3 were joined.", charges: 2 },
          { id: "s2", account: "BCA ••••4821", periodStart: "2026-08-01", periodEnd: "2026-08-31", linesAdded: 38, linesSkipped: 3, balanced: true, notes: null, charges: 0 },
          { id: "s3", account: "Wise USD", periodStart: "2026-07-01", periodEnd: "2026-09-30", linesAdded: 11, linesSkipped: 0, balanced: null, notes: null, charges: 0 },
        ]}
        lines={LINES}
        expected={[
          { key: "p1", code: "HMXK2A9T4Q", guest: "Tom", sentOn: "2026-09-26", arrivesBy: "2026-10-01", received: 2_139_976, currency: "IDR", state: "no_statement_yet" },
          { key: "p2", code: "HM4RZ8PLQW", guest: "Max", sentOn: "2026-09-08", arrivesBy: "2026-09-13", received: 5_766_035, currency: "IDR", state: "late" },
        ]}
        unpaid={[]}
      />
    </main>
  );
}
