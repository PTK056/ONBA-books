import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TransactionsView } from "@/components/transactions/TransactionsView";
import { places } from "@/lib/org";
import { listTransactions, type TxFilters } from "@/lib/transactions/data";

export default function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-8">
      <Suspense fallback={<div className="card h-96 animate-pulse" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/transactions">, "searchParams">) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const filters: TxFilters = {
    q: one("q"), month: one("month"), villa: one("villa"), category: one("category"), source: one("source"),
    direction: one("type") === "income" ? "in" : one("type") === "expense" ? "out" : undefined,
    receipt: one("receipt") === "missing" ? "missing" : one("receipt") === "attached" ? "attached" : undefined,
  };
  const result = await listTransactions(filters);
  if (result.kind === "signed_out") redirect("/login?next=/transactions");
  if (result.kind === "no_organization") redirect("/setup");
  const { org, rows, categories, truncated, villa } = result;
  // Which villa (or the company) only matters once entries are spread over more than one place.
  const showVilla = org.villas.length > 1 || (!!org.company && (villa === org.company.id || rows.some((r) => r.villa.id === org.company!.id)));
  return (
    <TransactionsView
      filters={filters} type={one("type")} rows={rows} truncated={truncated} categories={categories} villa={villa}
      places={places(org).map((v) => ({ id: v.id, name: v.name }))} showVilla={showVilla}
      editor={org.role !== "owner_viewer"} currency={org.reportingCurrency}
    />
  );
}
