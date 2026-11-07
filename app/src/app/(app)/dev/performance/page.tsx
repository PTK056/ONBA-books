// Development-only preview of the Performance page with synthetic books (a villa on a two-year lease), no Supabase
// needed. The buttons call the real server actions, so they fail here: this is for looking only.

import { notFound } from "next/navigation";
import { PerformanceView } from "@/components/performance/PerformanceView";
import { PageHeader } from "@/components/shell/PageHeader";
import { addMonths, facts, goalPath, type Data, type Entry, type Goal } from "@/lib/performance/metrics";
import { pulse } from "@/lib/performance/pulse";
import type { ReportView } from "@/lib/performance/render";

const V = "villa-1", C = "company";
const out = (date: string, amount: number, category: string, placeId = V): Entry => ({ date, placeId, direction: "out", amount, source: "manual", category, platform: null });

function books(): Data {
  const entries: Entry[] = [];
  const stays: Data["stays"] = [];
  for (let i = 0; i < 24; i++) entries.push(out(addMonths("2025-04-01", i), 20_833_333, "Lease"));
  entries.push(out("2025-05-01", 99_760_640, "Equipment"));
  // Nightly rate and nights sold by month, from June 2025 to October 2026.
  const season = [0.6, 0.7, 0.75, 0.65, 0.6, 0.5, 0.7, 0.35, 0.85, 0.6, 0.9, 0.6, 0.7, 0.75, 0.75, 0.75, 0.55];
  season.forEach((occ, i) => {
    const month = addMonths("2025-06-01", i);
    const days = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
    const nights = Math.round(days * occ);
    const adr = 1_450_000 + (i % 4) * 60_000;
    const checkOut = new Date(Date.parse(`${month}T00:00:00Z`) + nights * 86_400_000).toISOString().slice(0, 10);
    if (i === 16) {
      stays.push({ placeId: V, checkIn: month, checkOut: "2026-10-11", platform: "airbnb", refunded: false, bookedOn: "2026-09-02" });
      stays.push({ placeId: V, checkIn: "2026-10-15", checkOut: "2026-10-17", platform: "direct", refunded: false, bookedOn: "2026-10-10" });
    } else {
      stays.push({ placeId: V, checkIn: month, checkOut, platform: i < 5 ? "other" : "airbnb", refunded: false, bookedOn: null });
    }
    const income = nights * adr;
    entries.push({ date: month, placeId: V, direction: "in", amount: income, source: "stay", category: "Accommodation", platform: "airbnb" });
    if (i >= 5) entries.push({ date: month, placeId: V, direction: "out", amount: income * 0.15, source: "stay", category: "Platform fees", platform: "airbnb" });
    entries.push(out(month, 4_000_000, "Staff Salaries"), out(month, 1_000_000, "Electricity"), out(month, 600_000, "Pool"), out(month, 700_000, "Laundry"));
    entries.push(out(month, i === 16 ? 4_000_000 : 1_000_000, "Cleaning / Freelance"), out(month, 25_000, "Bank Fees", C));
  });
  stays.push({ placeId: V, checkIn: "2026-11-09", checkOut: "2026-11-24", platform: "airbnb", refunded: false, bookedOn: "2026-10-20" });
  entries.push({ date: "2026-11-09", placeId: V, direction: "in", amount: 23_329_677, source: "stay", category: "Accommodation", platform: "airbnb" });
  return {
    places: [{ id: V, name: "Casa ONBA", kind: "villa" }, { id: C, name: "PT Onba Property Management", kind: "company" }],
    entries, stays,
    blocks: [{ placeId: V, start: "2026-10-20", end: "2026-10-29", reason: "owner" }],
    goals: GOALS,
  };
}

const GOALS: Goal[] = [
  { id: "g1", label: "Break even", placeId: null, since: "2025-04-01", byDate: "2027-04-30", target: 0, invested: 599_760_640, planned: 20_833_333, plannedNote: "April 2027 share of the next lease year" },
  { id: "g2", label: "Positive return after the extra lease year", placeId: null, since: "2025-04-01", byDate: "2028-03-31", target: 0, invested: 849_760_640, planned: 250_000_000, plannedNote: "Lease year 2027-04 → 2028-03" },
];

export default function PerformancePreview() {
  if (process.env.NODE_ENV !== "development") notFound();
  const data = books();
  // Previewed as Performance opens: the current month, live (the report shown under Details is October's).
  const month = "2026-11-01";
  const f = facts(data, month, "2026-11-05", "IDR");
  const view: ReportView = {
    month, facts: f, last: { total: 3, done: 2 },
    analysis: {
      headline: "October sold 55% of its nights against 65% a year ago; break even by April needs 30.5M a month before the lease, the pace is 21.6M.",
      wins: [{ text: "Booked 20 days ahead on average, twice as early as in September." }, { text: "The direct stay saved about 300k of platform fees." }],
      issues: [{ text: "Occupancy fell to 54.5% (64.5% last October) and ADR to 1.43M (1.52M)." }, { text: "Cleaning / Freelance cost 4.0M, four times its average." }, { text: "Nothing is booked from 24 November to 4 January, a stretch that was 60% full last year." }],
      goals: "Break even: 9M a month short of the pace needed; even repeating last November to April leaves 67M to go.",
      previous: "The weekend rate went up 8%: ADR on Fridays and Saturdays +6%, occupancy stable.",
    },
    actions: [
      { id: "a1", position: 1, title: "Fill 24 Nov – 4 Jan: open 3-night minimum and a 10% early-December discount", why: "41 free nights in high season; the same days were 60% full last year.", impact: 14_800_000, impactNote: "41 nights × 25% more sold × ADR 1.43M", effort: "low", dueOn: "2026-11-12", status: "proposed" },
      { id: "a2", position: 2, title: "Check the two 2M Cleaning / Freelance payments of 26 October", why: "4.0M against a 1.0M average: possibly the same payment twice.", impact: 2_000_000, impactNote: "one 2M payment if it is a duplicate", effort: "low", dueOn: "2026-11-08", status: "accepted" },
      { id: "a3", position: 3, title: "Ask past direct guests back for December", why: "Direct stays save the 15% platform fee.", impact: null, impactNote: null, effort: "medium", dueOn: "2026-11-20", status: "proposed" },
    ],
  };
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-8">
      <PageHeader title="Performance" description="Preview with synthetic books." />
      <PerformanceView
        month={month} months={["2026-11-01", "2026-10-01", "2026-09-01"]} closed={false} report={null}
        view={view} facts={f} pulse={pulse(f, "2026-11-05")} done={{ a2: false }}
        paths={Object.fromEntries(GOALS.map((g) => [g.id, goalPath(g, data, month)]))}
        goals={GOALS}
        blocks={[{ id: "b1", villaId: V, start: "2026-10-20", end: "2026-10-29", reason: "owner", note: "Our own stay" }]}
        villas={[{ id: V, name: "Casa ONBA" }]}
        places={[{ id: V, name: "Casa ONBA" }, { id: C, name: "PT Onba Property Management" }]}
        firstEntry="2025-04-01" today="2026-11-05"
      />
    </main>
  );
}
