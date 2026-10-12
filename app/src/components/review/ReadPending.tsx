"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readBatches } from "@/lib/receipts/read";
import type { UnreadSummary } from "@/lib/review/types";

/** Asks the engine to read receipts that were uploaded but never read. */
export function ReadPending({ unread }: { unread: UnreadSummary }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "reading" | "failed">("idle");
  if (!unread.count) return null;

  const run = async () => {
    setState("reading");
    const result = await readBatches(unread.batchIds);
    if (result.read + result.failed === 0) setState("failed");
    else setState("idle");
    router.refresh();
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <span>
        {unread.count} uploaded receipt{unread.count === 1 ? " is" : "s are"} waiting to be read.
        {state === "failed" && " The engine did not respond; try again in a minute."}
      </span>
      <button
        onClick={run} disabled={state === "reading"}
        className="shrink-0 rounded-md bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-60"
      >
        {state === "reading" ? "Reading…" : "Read now"}
      </button>
    </div>
  );
}
