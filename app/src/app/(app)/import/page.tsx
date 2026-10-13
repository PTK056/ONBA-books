import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { StaysImport } from "@/components/stays/StaysImport";
import { getCurrentOrg } from "@/lib/org";

export default function ImportPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-8">
      <PageHeader
        title="Import stays"
        description="Your Airbnb transaction history becomes income and platform fees, split across months by nights."
      />
      <Suspense fallback={<div className="card h-64 animate-pulse" />}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const org = await getCurrentOrg();
  if (org.kind === "signed_out") redirect("/login?next=/import");
  if (org.kind === "none" || !org.villas.length) redirect("/setup");
  if (org.role === "owner_viewer") redirect("/overview");
  return <StaysImport villas={org.villas} reportingCurrency={org.reportingCurrency} />;
}
