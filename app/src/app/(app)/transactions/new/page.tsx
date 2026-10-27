import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { TxForm } from "@/components/transactions/TxForm";
import { getCurrentOrg, places } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export default function NewTransactionPage({ searchParams }: PageProps<"/transactions/new">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-8">
      <PageHeader title="New entry" description="Enter it by hand; attach the receipt now or later." />
      <Suspense fallback={<div className="card h-96 animate-pulse" />}>
        <Form searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Form({ searchParams }: Pick<PageProps<"/transactions/new">, "searchParams">) {
  const { type } = await searchParams;
  const org = await getCurrentOrg();
  if (org.kind === "signed_out") redirect("/login?next=/transactions/new");
  if (org.kind === "none" || !org.villas.length) redirect("/setup");
  if (org.role === "owner_viewer") redirect("/transactions");
  const db = await createClient();
  const { data: categories } = await db.from("categories").select("id, name, kind")
    .eq("organization_id", org.id).is("archived_at", null).order("name");
  return (
    <div className="card p-6">
      <TxForm
        mode="create" organizationId={org.id} reportingCurrency={org.reportingCurrency}
        villas={places(org)} categories={categories ?? []}
        initial={{ direction: type === "income" ? "in" : "out" }}
      />
    </div>
  );
}
