import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { Uploader } from "@/components/upload/Uploader";
import { getCurrentOrg } from "@/lib/org";

export default function UploadPage() {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<AppNav current="/upload" />}>
        <Upload />
      </Suspense>
    </main>
  );
}

async function Upload() {
  const org = await getCurrentOrg();
  if (org.kind === "signed_out") redirect("/login?next=/upload");
  if (org.kind === "none" || !org.villas.length) redirect("/setup");
  if (org.role === "owner_viewer") redirect("/review");
  return (
    <>
      <AppNav current="/upload" orgName={org.name} />
      <section className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-8">
        <h1 className="text-xl font-semibold">Add receipts</h1>
        <Uploader organizationId={org.id} villas={org.villas} />
      </section>
    </>
  );
}
