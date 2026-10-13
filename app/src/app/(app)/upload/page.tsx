import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { Uploader } from "@/components/upload/Uploader";
import { getCurrentOrg } from "@/lib/org";

export default function UploadPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-8">
      <PageHeader
        title="Add receipts"
        description="Photos or PDFs of receipts, invoices and transfer slips. Each one is read for you, then waits for your review."
      />
      <Suspense fallback={<div className="card h-64 animate-pulse" />}>
        <Upload />
      </Suspense>
    </main>
  );
}

async function Upload() {
  const org = await getCurrentOrg();
  if (org.kind === "signed_out") redirect("/login?next=/upload");
  if (org.kind === "none" || !org.villas.length) redirect("/setup");
  if (org.role === "owner_viewer") redirect("/overview");
  return (
    <div className="card p-6">
      <Uploader organizationId={org.id} villas={org.villas} />
    </div>
  );
}
