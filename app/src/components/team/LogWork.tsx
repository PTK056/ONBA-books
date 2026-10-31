"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { LogForm } from "@/components/team/TeamForms";
import type { Staff } from "@/lib/staff/ops";

/** A "Log work" button that opens the form in place, full width under the section title. */
export function LogWork(props: { staff: Staff[]; villas: { id: string; name: string }[]; today: string }) {
  const [open, setOpen] = useState(false);
  if (!props.staff.length) return null;
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
        <Plus size={15} />Log work
      </button>
    );
  }
  return <div className="w-full rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900"><LogForm {...props} onDone={() => setOpen(false)} /></div>;
}
