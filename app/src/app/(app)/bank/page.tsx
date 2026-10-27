import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { BankView } from "@/components/bank/BankView";
import { PageHeader } from "@/components/shell/PageHeader";
import { bankPage } from "@/lib/bank/data";
import { getCurrentOrg, places } from "@/lib/org";
import { bankSettings, type Bearer } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

// Reading a statement with Claude takes about half a minute.
export const maxDuration = 120;

export default function BankPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-8">
      <PageHeader
        title="Bank"
        description="Add your bank statements: what is at the bank but not in your books shows up here. Admins only."
      />
      <Suspense fallback={<div className="card h-64 animate-pulse" />}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const org = await getCurrentOrg();
  if (org.kind === "signed_out") redirect("/login?next=/bank");
  if (org.kind === "none" || !org.villas.length) redirect("/setup");
  if (org.role !== "admin") notFound();
  const db = await createClient();
  const [data, { data: cats }, settings] = await Promise.all([
    bankPage(db, org.id),
    db.from("categories").select("id, name, kind").eq("organization_id", org.id).is("archived_at", null).order("name"),
    bankSettings(db, org.id),
  ]);
  const bearer = (to: Bearer) => (to === "company" ? org.company?.name ?? "the company" : org.villas.length > 1 ? "shared between villas" : "the villa");
  const chargesTo = settings.feesTo === settings.interestTo ? bearer(settings.feesTo) : `${bearer(settings.feesTo)} / ${bearer(settings.interestTo)}`;
  return (
    <BankView
      organizationId={org.id} reportingCurrency={org.reportingCurrency}
      villas={places(org).map((v) => ({ id: v.id, name: v.name }))} chargesTo={chargesTo}
      categories={(cats ?? []) as { id: string; name: string; kind: "income" | "expense" }[]}
      {...data}
    />
  );
}
