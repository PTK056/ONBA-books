"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { answerAlert, checkNow, chooseVilla, connectGmail, disconnectGmail, type Result } from "@/app/(app)/connections/actions";
import { shortDate } from "@/lib/format/date";
import { Status } from "./ConnectorGrid";

const field = "h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm shadow-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-900";
const primary = "h-10 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50";
const secondary = "h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

export type GmailState =
  | { status: "none" }
  | { status: "pending" | "active" | "error"; account: string | null; lastChecked: string | null; error: string | null; readFrom: string | null };

export interface EmailRow {
  id: string; received_at: string | null; subject: string; kind: string; code: string | null;
  result: string; note: string | null; stay_id: string | null;
}
export interface WaitingListing { ref: string; name: string; bookings: number }

const RETURNED: Record<string, { text: string; ok: boolean }> = {
  connected: { text: "Gmail is connected. The first check (last 120 days) is running; refresh in a minute.", ok: true },
  denied: { text: "Access wasn't allowed, so nothing was connected.", ok: false },
  failed: { text: "Gmail could not be connected. Try again.", ok: false },
};

const KIND: Record<string, string> = {
  confirmed: "Booking", payout: "Payout", canceled: "Canceled", altered: "Changed",
  support_message: "Airbnb Support", ignored: "Not a booking", unrecognised: "Not recognised",
};

const RESULT: Record<string, { label: string; tone: "ok" | "muted" | "warn" }> = {
  booked: { label: "Stay added", tone: "ok" },
  updated: { label: "Stay updated", tone: "ok" },
  unchanged: { label: "Up to date", tone: "muted" },
  ignored: { label: "Ignored", tone: "muted" },
  waiting: { label: "Waiting", tone: "muted" },
  needs_villa: { label: "Choose the villa", tone: "warn" },
  conflict: { label: "Not saved", tone: "warn" },
  unrecognised: { label: "Not recognised", tone: "warn" },
  alert: { label: "Check the stay", tone: "warn" },
};

function useAction() {
  const router = useRouter();
  const [state, setState] = useState<{ error?: string; message?: string }>({});
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>) => start(async () => {
    const r = await fn();
    setState(r.ok ? { message: r.message } : { error: r.error });
    if (r.ok) router.refresh();
  });
  return { ...state, pending, run };
}

/** Today and the default start date (120 days back), worked out on the server. */
export interface Dates { today: string; defaultFrom: string }

export function GmailDetail({ gmail, dates, returned, emails, alerts, waiting, villas }: {
  gmail: GmailState; dates: Dates; returned: string | null; emails: EmailRow[]; alerts: EmailRow[]; waiting: WaitingListing[];
  villas: { id: string; name: string }[];
}) {
  const notice = returned ? RETURNED[returned] : undefined;
  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <p className={notice.ok ? "text-sm text-emerald-700 dark:text-emerald-400" : "text-sm text-red-600"}>{notice.text}</p>
      )}
      <GmailCard gmail={gmail} dates={dates} />
      {waiting.map((l) => <ChooseVilla key={l.ref} listing={l} villas={villas} />)}
      {alerts.map((a) => <Alert key={a.id} alert={a} />)}
      {gmail.status !== "none" && <EmailLog emails={emails} />}
    </div>
  );
}

function GmailCard({ gmail, dates }: { gmail: GmailState; dates: Dates }) {
  const { error, message, pending, run } = useAction();
  const connected = gmail.status === "active";
  const [readFrom, setReadFrom] = useState(dates.defaultFrom);
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div><Status status={connected ? "connected" : gmail.status === "none" ? "off" : "attention"} /></div>
      <p className="text-sm text-zinc-500">
        Once a day Splyce reads the e-mails Airbnb sends you (and only those): confirmed bookings become stays,
        payouts give the real rate, cancellations are marked. Requests, inquiries and messages are never booked.
      </p>
      {gmail.status !== "none" && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-zinc-500">Mailbox</dt><dd>{gmail.account ?? "—"}</dd>
          <dt className="text-zinc-500">Reads from</dt><dd>{gmail.readFrom ? shortDate(gmail.readFrom.slice(0, 10)) : "the last 120 days"}</dd>
          <dt className="text-zinc-500">Last check</dt>
          <dd>{gmail.lastChecked ? `${shortDate(gmail.lastChecked.slice(0, 10))} ${gmail.lastChecked.slice(11, 16)} UTC` : "Not yet"}</dd>
          {gmail.error && <><dt className="text-zinc-500">Problem</dt><dd className="text-red-600">{gmail.error}</dd></>}
        </dl>
      )}
      <div className="flex flex-wrap gap-2">
        {connected ? (
          <>
            <button type="button" className={primary} disabled={pending} onClick={() => run(checkNow)}>
              {pending ? "Checking…" : "Check now"}
            </button>
            <button type="button" className={secondary} disabled={pending}
              onClick={() => confirm("Disconnect Gmail? Stays already added are kept.") && run(disconnectGmail)}>
              Disconnect
            </button>
          </>
        ) : (
          <>
            <label className="flex w-full flex-col gap-1 text-sm font-medium sm:w-auto">
              Read e-mails from
              <input type="date" className={field} value={readFrom} max={dates.today} onChange={(e) => setReadFrom(e.target.value)} />
            </label>
            <p className="w-full text-xs text-zinc-500">
              Nothing older is read. If your books are already up to date until a day (an import, a migration), start that day.
            </p>
            <button type="button" className={primary} disabled={pending || !readFrom} onClick={() => run(() => connectGmail(readFrom))}>
              {gmail.status === "none" ? "Connect Gmail" : "Connect again"}
            </button>
            {gmail.status !== "none" && (
              <button type="button" className={secondary} disabled={pending} onClick={() => run(disconnectGmail)}>Remove</button>
            )}
          </>
        )}
      </div>
      {gmail.status === "none" && (
        <p className="text-xs text-zinc-500">
          Google will say the access is for Composio, the service Splyce uses to connect Gmail during the pilot.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
    </section>
  );
}

function ChooseVilla({ listing, villas }: { listing: WaitingListing; villas: { id: string; name: string }[] }) {
  const [villa, setVilla] = useState(villas.length === 1 ? villas[0].id : "");
  const { error, pending, run } = useAction();
  return (
    <section className="card flex flex-col gap-3 border-amber-300 p-5 dark:border-amber-700">
      <h2 className="font-semibold">Which villa is this listing?</h2>
      <p className="text-sm text-zinc-500">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{listing.name}</span> · {listing.bookings} booking
        {listing.bookings === 1 ? "" : "s"} waiting. Asked once: later bookings of this listing go to the same villa.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <select className={`${field} min-w-56 flex-1`} value={villa} onChange={(e) => setVilla(e.target.value)} aria-label="Villa">
          <option value="">Choose a villa…</option>
          {villas.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <button type="button" className={primary} disabled={!villa || pending}
          onClick={() => run(() => chooseVilla(listing.ref, listing.name, villa))}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

/** Airbnb Support wrote about a booking: cancel the stay or keep it. */
function Alert({ alert }: { alert: EmailRow }) {
  return (
    <section className="card flex flex-col gap-2 border-amber-300 p-5 dark:border-amber-700">
      <h2 className="font-semibold">Airbnb Support wrote about a stay</h2>
      <p className="text-sm text-zinc-500">{alert.note}</p>
      <AlertAnswer id={alert.id} />
    </section>
  );
}

function AlertAnswer({ id }: { id: string }) {
  const { error, pending, run } = useAction();
  const small = "h-8 rounded-lg px-3 text-xs font-medium disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <button type="button" disabled={pending} className={`${small} bg-emerald-600 text-white hover:bg-emerald-700`}
        onClick={() => run(() => answerAlert(id, "cancel"))}>Cancel stay</button>
      <button type="button" disabled={pending} className={`${small} border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800`}
        onClick={() => run(() => answerAlert(id, "keep"))}>Keep</button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

function EmailLog({ emails }: { emails: EmailRow[] }) {
  if (!emails.length) {
    return <section className="card p-5 text-sm text-zinc-500">No e-mail from Airbnb read yet.</section>;
  }
  const tone = { ok: "text-emerald-700 dark:text-emerald-400", muted: "text-zinc-500", warn: "text-amber-700 dark:text-amber-400" };
  return (
    <details className="card group p-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
        E-mails read <span className="text-zinc-400">· {emails.length}{emails.length === 50 ? "+" : ""}</span>
        <ChevronDown className="ml-auto size-4 text-zinc-400 transition group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
        {emails.map((e) => {
          const r = RESULT[e.result] ?? { label: e.result, tone: "muted" as const };
          return (
            <li key={e.id} className="flex flex-col gap-0.5 px-5 py-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="w-16 shrink-0 text-zinc-500">{e.received_at ? shortDate(e.received_at.slice(0, 10)) : "—"}</span>
                <span className="font-medium">{KIND[e.kind] ?? e.kind}</span>
                {e.code && <span className="font-mono text-xs text-zinc-500">{e.code}</span>}
                <span className={`ml-auto ${tone[r.tone]}`}>{r.label}</span>
              </div>
              <p className="truncate pl-0 text-zinc-500 sm:pl-[4.75rem]">{e.subject}</p>
              {e.note && <p className="pl-0 text-xs text-zinc-500 sm:pl-[4.75rem]">{e.note}</p>}
              {e.stay_id && e.code && (
                <Link href={`/transactions?q=${encodeURIComponent(e.code)}`} className="pl-0 text-xs font-medium text-emerald-700 underline sm:pl-[4.75rem] dark:text-emerald-400">
                  See the entries
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
