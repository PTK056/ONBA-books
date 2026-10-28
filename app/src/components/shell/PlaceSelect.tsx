"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { choosePlace } from "@/app/place/actions";

/** "Villa: All villas / Villa A / … / the company": what the pages show, remembered on this device. */
export function PlaceSelect({ places, selected, compact }: { places: { id: string; name: string }[]; selected: string | null; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Villa" value={selected ?? ""} disabled={pending}
      onChange={(e) => start(async () => { await choosePlace(e.target.value || null); router.refresh(); })}
      className={`${compact ? "h-9 max-w-36 text-xs" : "h-9 w-full text-sm"} truncate rounded-lg border border-zinc-200 bg-white px-2 font-medium outline-none focus:border-emerald-500 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950`}
    >
      <option value="">All villas</option>
      {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}
