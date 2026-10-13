"use client";

import { LayoutDashboard, ScanLine, Upload } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";

const NAV = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/upload", label: "Add receipts", icon: Upload },
  { href: "/review", label: "Review", icon: ScanLine, badge: true },
] as const;

interface Props {
  org: React.ReactNode;
  reviewBadge: React.ReactNode;
  user: React.ReactNode;
}

/** Fixed sidebar on large screens; a compact top bar with tabs below that. */
export function Sidebar({ org, reviewBadge, user }: Props) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-zinc-200 bg-white px-3 py-4 lg:flex dark:border-zinc-800 dark:bg-zinc-950">
        <Link href="/overview" className="px-2"><Logo /></Link>
        <div className="mt-6 px-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Organization</div>
        <div className="mt-1 truncate px-2 text-sm font-medium">{org}</div>
        <nav className="mt-6 flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon, ...rest }) => (
            <Link
              key={href} href={href} aria-current={active(href) ? "page" : undefined}
              className="group flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 aria-[current=page]:bg-zinc-100 aria-[current=page]:font-medium aria-[current=page]:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100 dark:aria-[current=page]:bg-zinc-900 dark:aria-[current=page]:text-zinc-100"
            >
              <Icon size={17} className="text-zinc-400 group-aria-[current=page]:text-emerald-600" />
              <span className="flex-1">{label}</span>
              {"badge" in rest && reviewBadge}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-zinc-200 pt-3 dark:border-zinc-800">{user}</div>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-950/90">
        <Link href="/overview"><Logo className="text-sm" /></Link>
        <nav className="ml-auto flex gap-1 overflow-x-auto">
          {NAV.map(({ href, label, icon: Icon, ...rest }) => (
            <Link
              key={href} href={href} aria-label={label} aria-current={active(href) ? "page" : undefined}
              className="relative flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-zinc-500 aria-[current=page]:bg-zinc-100 aria-[current=page]:text-zinc-900 dark:aria-[current=page]:bg-zinc-900 dark:aria-[current=page]:text-zinc-100"
            >
              <Icon size={17} />
              <span className="hidden sm:inline">{label}</span>
              {"badge" in rest && reviewBadge}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
