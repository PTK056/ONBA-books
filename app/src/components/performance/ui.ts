import { useState, useTransition } from "react";
import type { Result } from "@/app/(app)/performance/actions";

export const field = "h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-brand-600 dark:border-zinc-700 dark:bg-zinc-900";
export const primary = "h-9 rounded-lg bg-brand-600 px-3 btn-label shadow-sm hover:bg-brand-700 disabled:opacity-50";
export const secondary = "h-9 rounded-lg border border-zinc-300 px-3 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

export const good = "bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100";
export const bad = "bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100";
export const neutral = "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

export const monthName = (m: string, style: "long" | "short" = "long") =>
  new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en", { month: style, year: "numeric", timeZone: "UTC" });
export const shortMonth = (m: string) =>
  new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en", { month: "short", timeZone: "UTC" });
export const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A server action run from a button: pending while it runs, its error kept to show. */
export function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>, after?: () => void) => start(async () => {
    setError(null);
    const r = await fn();
    if (!r.ok) setError(r.error);
    else after?.();
  });
  return { pending, error, run };
}
