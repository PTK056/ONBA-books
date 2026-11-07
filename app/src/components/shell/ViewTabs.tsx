import Link from "next/link";

export interface ViewTab { key: string; label: string; href: string; badge?: number }

/**
 * Views of one sidebar section, side by side (Entries | Documents, Scan | To review, Month … Performance): the pages
 * keep their own address, the sidebar shows one section for them.
 */
export function ViewTabs({ tabs, current, label }: { tabs: ViewTab[]; current: string; label: string }) {
  return (
    <nav className="inline-flex h-9 items-center rounded-lg bg-zinc-200/60 p-0.5 text-sm dark:bg-zinc-800" aria-label={label}>
      {tabs.map((t) => (
        <Link
          key={t.key} href={t.href} aria-current={current === t.key ? "page" : undefined}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-zinc-600 aria-[current=page]:bg-white aria-[current=page]:font-medium aria-[current=page]:text-zinc-900 aria-[current=page]:shadow-sm dark:text-zinc-400 dark:aria-[current=page]:bg-zinc-950 dark:aria-[current=page]:text-zinc-100"
        >
          {t.label}
          {!!t.badge && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-4 text-sidebar">{t.badge}</span>}
        </Link>
      ))}
    </nav>
  );
}

export const BOOKS_TABS: ViewTab[] = [
  { key: "entries", label: "Entries", href: "/transactions" },
  { key: "documents", label: "Documents", href: "/documents" },
];

export const receiptTabs = (toReview?: number): ViewTab[] => [
  { key: "scan", label: "Scan", href: "/upload" },
  { key: "review", label: "To review", href: "/review", badge: toReview },
];
