"use client";

import { useState, useTransition } from "react";
import { setMonthClosed } from "@/app/(app)/overview/actions";

interface Props {
  villaId: string;
  villaName: string;
  month: string;
  monthName: string;
  closed: boolean;
  canEdit: boolean;
  /** Things to settle first; closing is still allowed, with these shown. */
  warnings: string[];
}

export function MonthClose({ villaId, villaName, month, monthName, closed, canEdit, warnings }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (close: boolean) => start(async () => {
    setError(null);
    const r = await setMonthClosed(villaId, month, close);
    if (!r.ok) setError(r.error);
    else setConfirming(false);
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{villaName}</span>
        <span className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${closed
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}>
            {closed ? "🔒 Closed" : "Open"}
          </span>
          {canEdit && !confirming && (
            <button
              onClick={() => (closed ? run(false) : setConfirming(true))} disabled={pending}
              className="text-xs text-zinc-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-zinc-400"
            >
              {closed ? "Reopen" : `Close ${monthName}`}
            </button>
          )}
        </span>
      </div>
      {confirming && (
        <div className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          {warnings.length ? (
            <>
              <p className="font-medium">Before closing:</p>
              <ul className="mt-1 list-disc pl-5 text-amber-800 dark:text-amber-200">
                {warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </>
          ) : (
            <p>Everything for {monthName} is reviewed and backed by a receipt.</p>
          )}
          <p className="mt-2 text-xs text-zinc-500">Once closed, entries dated in {monthName} can no longer be changed; corrections go into an open month.</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => run(true)} disabled={pending} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
              {pending ? "Closing…" : warnings.length ? "Close anyway" : `Close ${monthName}`}
            </button>
            <button onClick={() => setConfirming(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs dark:border-zinc-700">Cancel</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
