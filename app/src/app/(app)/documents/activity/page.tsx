import { Archive, Download, Link2 } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { shortDate } from "@/lib/format/date";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

const LIMIT = 300;

/** Admins only: who took which documents out of the app, most recent first. */
export default function DownloadActivityPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8">
      <Suspense fallback={<div className="card h-96 animate-pulse" />}>
        <Content />
      </Suspense>
    </main>
  );
}

type Row = { id: string; user_email: string | null; kind: "zip" | "share_link" | "file"; files: number; details: Record<string, unknown>; created_at: string };

const KIND = {
  zip: { icon: Archive, label: "ZIP" },
  share_link: { icon: Link2, label: "Share link (7 days)" },
  file: { icon: Download, label: "Download" },
};

async function Content() {
  const org = await getCurrentOrg();
  if (org.kind === "signed_out") redirect("/login?next=/documents/activity");
  if (org.kind !== "member" || org.role !== "admin") notFound();
  const db = await createClient();
  const { data } = await db.from("download_log").select("id, user_email, kind, files, details, created_at")
    .eq("organization_id", org.id).order("created_at", { ascending: false }).limit(LIMIT);
  const rows = (data ?? []) as Row[];

  return (
    <>
      <PageHeader
        title="Download activity"
        description="Who downloaded or shared documents from the app. Visible to admins only; entries can't be edited or deleted."
        actions={<Link href="/documents" className="h-9 rounded-lg border border-zinc-300 px-3 text-sm font-medium leading-9 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Back to documents</Link>}
      />
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">No downloads yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Who</th>
                <th className="px-4 py-3 font-medium">What</th>
                <th className="px-4 py-3 text-right font-medium">Files</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const k = KIND[r.kind];
                return (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-500">{shortDate(r.created_at)} {r.created_at.slice(11, 16)} UTC</td>
                    <td className="px-4 py-3">{r.user_email ?? "Deleted user"}</td>
                    <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><k.icon size={14} className="text-zinc-400" />{k.label}</span> <span className="text-zinc-500">{describe(r)}</span></td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.files}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {rows.length === LIMIT && <p className="text-xs text-zinc-500">Showing the latest {LIMIT}.</p>}
    </>
  );
}

function describe(r: Row): string {
  const d = r.details;
  if (r.kind === "zip") return [d.month && `month ${d.month}`, d.category && "one category", d.villa && "one villa"].filter(Boolean).join(", ") || "";
  return typeof d.name === "string" ? d.name : "";
}
