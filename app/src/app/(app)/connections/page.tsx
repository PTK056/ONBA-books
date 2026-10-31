import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ConnectionsView, type EmailRow, type GmailState, type WaitingListing } from "@/components/connections/ConnectionsView";
import { PageHeader } from "@/components/shell/PageHeader";
import { daysBefore, todayIn } from "@/lib/format/date";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export default function ConnectionsPage({ searchParams }: PageProps<"/connections">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-8">
      <PageHeader title="Connections" description="What Splyce reads for you. Only admins can see and change them." />
      <Suspense fallback={<div className="card h-64 animate-pulse" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/connections">, "searchParams">) {
  const org = await getCurrentOrg();
  if (org.kind === "signed_out") redirect("/login?next=/connections");
  if (org.kind === "none") redirect("/setup");
  if (org.role !== "admin") notFound();
  const { gmail: returned } = await searchParams;
  const today = todayIn("UTC");

  const db = await createClient();
  const [{ data: conn }, { data: emails }, { data: waiting }] = await Promise.all([
    db.from("mail_connections").select("status, account_label, last_checked_at, last_error, read_from").eq("organization_id", org.id).maybeSingle(),
    db.from("inbound_emails").select("id, received_at, subject, kind, code, result, note, stay_id")
      .eq("organization_id", org.id).order("received_at", { ascending: false }).limit(30),
    db.from("inbound_emails").select("listing_ref, parsed").eq("organization_id", org.id).eq("result", "needs_villa"),
  ]);

  const gmail: GmailState = conn
    ? { status: conn.status as GmailState["status"], account: conn.account_label, lastChecked: conn.last_checked_at, error: conn.last_error, readFrom: conn.read_from }
    : { status: "none" };
  const listings = new Map<string, WaitingListing>();
  for (const w of waiting ?? []) {
    if (!w.listing_ref) continue;
    const name = (w.parsed as { listing?: string }).listing ?? w.listing_ref;
    const l = listings.get(w.listing_ref) ?? { ref: w.listing_ref, name, bookings: 0 };
    l.bookings++;
    listings.set(w.listing_ref, l);
  }

  return (
    <ConnectionsView
      gmail={gmail}
      dates={{ today, defaultFrom: daysBefore(today, 120) }}
      returned={typeof returned === "string" ? returned : null}
      emails={(emails ?? []) as EmailRow[]}
      waiting={[...listings.values()]}
      villas={org.villas}
      telegramBot={process.env.TELEGRAM_BOT_USERNAME ?? null}
    />
  );
}
