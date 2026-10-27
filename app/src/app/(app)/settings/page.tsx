import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { SettingsForms } from "@/components/settings/SettingsForms";
import { PageHeader } from "@/components/shell/PageHeader";
import { getCurrentOrg } from "@/lib/org";
import { bankSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export default function SettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-8">
      <PageHeader title="Settings" description="How your organization books what is not one villa's. Admins only." />
      <Suspense fallback={<div className="card h-64 animate-pulse" />}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const org = await getCurrentOrg();
  if (org.kind === "signed_out") redirect("/login?next=/settings");
  if (org.kind === "none") redirect("/setup");
  if (org.role !== "admin" || !org.company) notFound();
  const bank = await bankSettings(await createClient(), org.id);
  return <SettingsForms company={org.company.name} villaCount={org.villas.length} bank={bank} />;
}
