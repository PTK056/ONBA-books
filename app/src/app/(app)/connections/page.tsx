import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ConnectorGrid, LOGOS, type Connector } from "@/components/connections/ConnectorGrid";
import { PageHeader } from "@/components/shell/PageHeader";
import { getCurrentOrg } from "@/lib/org";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export default function ConnectionsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-8">
      <PageHeader title="Connections" description="The services Splyce reads for you. Only admins can see and change them." />
      <Suspense fallback={<div className="grid gap-4 sm:grid-cols-2"><div className="card h-40 animate-pulse" /><div className="card h-40 animate-pulse" /></div>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const org = await getCurrentOrg();
  if (org.kind === "signed_out") redirect("/login?next=/connections");
  if (org.kind === "none") redirect("/setup");
  if (org.role !== "admin") notFound();

  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  const [{ data: conn }, { count: toLookAt }, { data: chat }] = await Promise.all([
    db.from("mail_connections").select("status, account_label, last_error").eq("organization_id", org.id).maybeSingle(),
    db.from("inbound_emails").select("id", { count: "exact", head: true })
      .eq("organization_id", org.id).in("result", ["needs_villa", "alert"]),
    // Chat links are personal (one per user) and kept out of the API: read with the server key, for this user only.
    adminClient().from("channel_links").select("external_name, linked_at")
      .eq("user_id", claims!.claims.sub).eq("channel", "telegram").not("external_id", "is", null).maybeSingle(),
  ]);

  const bot = process.env.TELEGRAM_BOT_USERNAME;
  const gmailStatus = !conn ? "off" : conn.status !== "active" || conn.last_error || toLookAt ? "attention" : "connected";
  const connectors: Connector[] = [
    {
      key: "gmail", name: "Gmail", logo: LOGOS.gmail, href: "/connections/gmail", status: gmailStatus,
      description: "Airbnb's e-mails become stays: bookings, payouts at the real rate, cancellations.",
      detail: !conn ? null
        : toLookAt ? `${toLookAt} to look at · ${conn.account_label ?? ""}`
        : conn.last_error ? "Last check failed" : conn.account_label,
    },
    {
      key: "telegram", name: "Telegram", logo: LOGOS.telegram, status: chat ? "connected" : "off",
      description: "Sply, your assistant: receipts, expenses and stays in a chat, and the morning brief.",
      detail: chat ? (chat.external_name ? `Chat with ${chat.external_name}` : "Your chat is linked") : bot ? `Open @${bot} and send /start` : null,
      href: bot ? `https://t.me/${bot}` : undefined, external: true,
    },
    { key: "whatsapp", name: "WhatsApp", logo: LOGOS.whatsapp, status: "soon", description: "Sply on WhatsApp, for you and your staff." },
    { key: "outlook", name: "Outlook", logo: LOGOS.outlook, status: "soon", description: "Airbnb bookings from an Outlook or Hotmail mailbox." },
    { key: "booking", name: "Booking.com", logo: LOGOS.booking, status: "soon", description: "Stays and payouts from Booking.com." },
  ];
  return <ConnectorGrid connectors={connectors} />;
}
