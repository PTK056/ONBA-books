import { BedDouble, ChevronDown, Minus, Plus, ScanLine } from "lucide-react";
import Link from "next/link";

const ITEMS = [
  { href: "/upload", icon: ScanLine, label: "Scan receipts", hint: "Photos or PDFs, read for you" },
  { href: "/transactions/new", icon: Minus, label: "Expense by hand", hint: "Attach the receipt now or later" },
  { href: "/transactions/new?type=income", icon: Plus, label: "Income by hand", hint: "Direct booking, extra service…" },
  { href: "/import", icon: BedDouble, label: "Import Airbnb stays", hint: "Transaction history CSV" },
] as const;

/** The one way to add something, same menu on every page. */
export function NewMenu() {
  return (
    <details className="group relative">
      <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 [&::-webkit-details-marker]:hidden">
        <Plus size={16} /> New <ChevronDown size={14} className="transition group-open:rotate-180" />
      </summary>
      <div className="card absolute left-0 z-30 mt-1.5 w-64 p-1.5 sm:left-auto sm:right-0">
        {ITEMS.map(({ href, icon: Icon, label, hint }) => (
          <Link key={href} href={href} className="flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <Icon size={16} className="mt-0.5 shrink-0 text-emerald-600" />
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-zinc-500">{hint}</span>
            </span>
          </Link>
        ))}
      </div>
    </details>
  );
}
