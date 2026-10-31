// Development-only preview of the Connections page and the Gmail page, with synthetic data.

import { notFound } from "next/navigation";
import { ConnectorGrid, LOGOS } from "@/components/connections/ConnectorGrid";
import { GmailDetail } from "@/components/connections/ConnectionsView";
import { PageHeader } from "@/components/shell/PageHeader";

export default function DevConnections() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-8">
      <PageHeader title="Connections" description="Dev preview with synthetic data." />
      <ConnectorGrid connectors={[
        { key: "gmail", name: "Gmail", logo: LOGOS.gmail, href: "#gmail", status: "connected",
          description: "Airbnb's e-mails become stays: bookings, payouts at the real rate, cancellations.", detail: "host@example.com" },
        { key: "telegram", name: "Telegram", logo: LOGOS.telegram, href: "#", external: true, status: "off",
          description: "Sply, your assistant: receipts, expenses and stays in a chat, and the morning brief.", detail: "Open @SplyBot and send /start" },
        { key: "whatsapp", name: "WhatsApp", logo: LOGOS.whatsapp, status: "soon", description: "Sply on WhatsApp, for you and your staff." },
        { key: "outlook", name: "Outlook", logo: LOGOS.outlook, status: "soon", description: "Airbnb bookings from an Outlook or Hotmail mailbox." },
        { key: "booking", name: "Booking.com", logo: LOGOS.booking, status: "soon", description: "Stays and payouts from Booking.com." },
      ]} />
      <div id="gmail" className="mt-8 flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Gmail page</h2>
        <GmailDetail
          gmail={{ status: "active", account: "host@example.com", lastChecked: "2026-10-31T04:50:50Z", error: null, readFrom: "2026-10-20T00:00:00Z" }}
          dates={{ today: "2026-10-31", defaultFrom: "2026-07-03" }}
          returned={null}
          waiting={[]}
          villas={[{ id: "v1", name: "Villa One" }]}
          alerts={[{ id: "a1", received_at: "2026-10-26T10:00:00Z", subject: "New message from Airbnb Support", kind: "support_message",
            code: "HMAAAA0006", result: "alert", note: "Airbnb Support wrote about HMAAAA0006 (Max): check the stay", stay_id: null }]}
          emails={[
            { id: "e1", received_at: "2026-10-31T04:00:00Z", subject: "We sent a payout of Rp8,643,874.00 IDR", kind: "payout", code: "HMAAAA0001", result: "booked", note: "Paid", stay_id: "s1" },
            { id: "e2", received_at: "2026-10-29T04:00:00Z", subject: "Reservation confirmed - Jane Walker arrives Oct 30", kind: "confirmed", code: "HMAAAA0001", result: "booked", note: "Paid", stay_id: "s1" },
            { id: "e3", received_at: "2026-10-29T03:00:00Z", subject: "Inquiry for Villa Example", kind: "ignored", code: null, result: "ignored", note: "Inquiry", stay_id: null },
          ]}
        />
      </div>
    </main>
  );
}
