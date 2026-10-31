import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BookingLogo, GmailLogo, OutlookLogo, TelegramLogo, WhatsAppLogo } from "./logos";

// The connections page: one card per service, its logo, what it does and whether it is on.
// Details (settings, e-mails read) live on each connector's own page.

export type ConnectorStatus = "connected" | "attention" | "off" | "soon";

export interface Connector {
  key: string;
  name: string;
  logo: ReactNode;
  description: string;
  status: ConnectorStatus;
  /** Under the status: the mailbox, the chat, "2 to look at"… */
  detail?: string | null;
  /** The card opens this (own page, or an outside link). */
  href?: string;
  external?: boolean;
}

export function ConnectorGrid({ connectors }: { connectors: Connector[] }) {
  const live = connectors.filter((c) => c.status !== "soon");
  const soon = connectors.filter((c) => c.status === "soon");
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-2">{live.map((c) => <Card key={c.key} c={c} />)}</div>
      {soon.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-zinc-500">Coming soon</h2>
          <div className="grid gap-4 sm:grid-cols-2">{soon.map((c) => <Card key={c.key} c={c} />)}</div>
        </section>
      )}
    </div>
  );
}

function Card({ c }: { c: Connector }) {
  const body = (
    <>
      <div className="flex items-start gap-4">
        <div className={`flex size-12 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 ${c.status === "soon" ? "opacity-60 grayscale" : ""}`}>
          <div className="size-8">{c.logo}</div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{c.name}</h3>
            {c.href && c.status !== "soon" && <ChevronRight className="ml-auto size-4 text-zinc-400 transition group-hover:translate-x-0.5" aria-hidden />}
          </div>
          <p className="text-sm text-zinc-500">{c.description}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <Status status={c.status} />
        {c.detail && <span className="truncate text-xs text-zinc-500">{c.detail}</span>}
      </div>
    </>
  );
  const box = "card group flex h-full flex-col gap-4 p-5 transition";
  if (!c.href || c.status === "soon") return <div className={`${box} ${c.status === "soon" ? "bg-zinc-50/60 dark:bg-zinc-900/40" : ""}`}>{body}</div>;
  return c.external
    ? <a href={c.href} target="_blank" rel="noreferrer" className={`${box} hover:border-emerald-300 hover:shadow-md`}>{body}</a>
    : <Link href={c.href} className={`${box} hover:border-emerald-300 hover:shadow-md`}>{body}</Link>;
}

export function Status({ status }: { status: ConnectorStatus }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500 shadow-[0_0_6px_2px_rgba(16,185,129,0.6)]" />
        </span>
        Connected
      </span>
    );
  }
  const look = {
    attention: { label: "Needs attention", cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400", dot: "bg-amber-500" },
    off: { label: "Not connected", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400", dot: "bg-zinc-400" },
    soon: { label: "Coming soon", cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500", dot: "bg-zinc-300 dark:bg-zinc-600" },
  }[status];
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${look.cls}`}>
      <span className={`size-2 rounded-full ${look.dot}`} />
      {look.label}
    </span>
  );
}

export const LOGOS = { gmail: <GmailLogo />, telegram: <TelegramLogo />, whatsapp: <WhatsAppLogo />, outlook: <OutlookLogo />, booking: <BookingLogo /> };
