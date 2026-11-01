import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DocumentsView } from "@/components/documents/DocumentsView";
import { listTransactions, signFiles } from "@/lib/transactions/data";

export default function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8">
      <Suspense fallback={<div className="card h-96 animate-pulse" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/documents">, "searchParams">) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const q = one("q");
  const month = one("month")?.match(/^\d{4}-\d{2}$/)?.[0];
  const category = one("category")?.match(/^[0-9a-f-]{36}$/i)?.[0];
  const year = month?.slice(0, 4) ?? one("year")?.match(/^\d{4}$/)?.[0];

  const result = await listTransactions({ receipt: "attached", q });
  if (result.kind === "signed_out") redirect("/login?next=/documents");
  if (result.kind === "no_organization") redirect("/setup");
  return (
    <DocumentsView
      q={q} month={month} year={year} category={category} all={result.rows} categories={result.categories}
      admin={result.org.role === "admin"} villas={result.org.villas.length} sign={signFiles}
    />
  );
}
