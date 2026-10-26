import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Logo } from "@/components/shell/Logo";
import { getCurrentOrg } from "@/lib/org";
import { SetupForm } from "./SetupForm";

export default function SetupPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-12">
      <Logo />
      <div>
        <h1 className="text-2xl font-semibold">Welcome to Splyce</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Two details and you can add your first receipts.</p>
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <div className="card p-6"><Setup /></div>
      </Suspense>
    </main>
  );
}

async function Setup() {
  const org = await getCurrentOrg();
  if (org.kind === "signed_out") redirect("/login?next=/setup");
  if (org.kind === "member" && org.villas.length) redirect("/upload");
  if (org.kind === "member" && org.role !== "admin") {
    return <p className="text-sm">Your organization has no villa yet. Ask an admin to add one.</p>;
  }
  return <SetupForm hasOrg={org.kind === "member"} />;
}
