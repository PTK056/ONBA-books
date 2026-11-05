"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Logo } from "./Logo";
import { NAV_ICONS as I } from "./NavIcons";

const NAV = [
  { href: "/overview", label: "Overview", icon: I.overview },
  { href: "/transactions", label: "Transactions", icon: I.transactions },
  { href: "/documents", label: "Documents", icon: I.documents },
  { href: "/upload", label: "Scan receipts", icon: I.scan },
  { href: "/review", label: "Review", icon: I.review, badge: true },
  { href: "/import", label: "Import stays", icon: I.stays },
  { href: "/team", label: "Team", icon: I.team },
  { href: "/bank", label: "Bank", icon: I.bank, adminOnly: true },
  { href: "/performance", label: "Performance", icon: I.performance, adminOnly: true },
  { href: "/connections", label: "Connections", icon: I.connections, adminOnly: true },
  { href: "/settings", label: "Settings", icon: I.settings, adminOnly: true },
] as const;

interface Props {
  org: React.ReactNode;
  reviewBadge: React.ReactNode;
  user: React.ReactNode;
  /** The villa chooser, under the organization (and in the top bar on small screens). */
  place?: React.ReactNode;
  placeCompact?: React.ReactNode;
  /** Shows the admin-only pages (Bank, Settings). */
  admin?: boolean;
}

/** Fixed sidebar on large screens; a compact top bar with tabs below that. */
export function Sidebar(props: Props) {
  const path = usePathname();
  const from = useSearchParams().get("from") ?? "";
  // An entry opened from Documents stays under Documents.
  const fromDocuments = path.startsWith("/transactions/") && /^\/documents(\?|$)/.test(from);
  return <SidebarView {...props} path={fromDocuments ? "/documents" : path} />;
}

/** The same sidebar with no current page highlighted, shown while the path is resolved. */
export function SidebarView({ org, reviewBadge, user, path, admin, place, placeCompact }: Props & { path: string | null }) {
  const active = (href: string) => path !== null && (path === href || path.startsWith(`${href}/`));
  const nav = NAV.filter((item) => admin || !("adminOnly" in item));

  return (
    <>
      <aside className="dark-surface fixed inset-y-0 left-0 hidden w-60 flex-col bg-sidebar px-3 py-4 text-white lg:flex">
        <Link href="/overview" className="px-2"><Logo /></Link>
        <div className="mt-6 px-2 text-xs font-medium uppercase tracking-wide text-white/55">Organization</div>
        <div className="mt-1 truncate px-2 text-sm font-medium">{org}</div>
        {place && (
          <>
            <div className="mt-4 px-2 text-xs font-medium uppercase tracking-wide text-white/55">Villa</div>
            <div className="mt-1 px-1">{place}</div>
          </>
        )}
        <nav className="mt-6 flex flex-col gap-0.5">
          {nav.map(({ href, label, icon: Icon, ...rest }) => (
            <Link
              key={href} href={href} aria-current={active(href) ? "page" : undefined}
              className="group flex items-center gap-2.5 rounded-full px-3 py-2 text-sm text-white/70 [--icon-dot:var(--color-accent)] aria-[current=page]:[--icon-dot:currentColor] hover:bg-white/5 hover:text-white aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-sidebar"
            >
              <Icon size={17} className="text-white/50 group-aria-[current=page]:text-sidebar" />
              <span className="flex-1">{label}</span>
              {"badge" in rest && reviewBadge}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-white/10 pt-3">{user}</div>
      </aside>

      <header className="dark-surface sticky top-0 z-20 flex h-14 items-center gap-3 bg-sidebar/95 px-4 text-white backdrop-blur lg:hidden">
        <Link href="/overview"><Logo className="text-xl" /></Link>
        {placeCompact}
        <nav className="ml-auto flex gap-1 overflow-x-auto">
          {nav.map(({ href, label, icon: Icon, ...rest }) => (
            <Link
              key={href} href={href} aria-label={label} aria-current={active(href) ? "page" : undefined}
              className="relative flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm text-white/70 [--icon-dot:var(--color-accent)] aria-[current=page]:[--icon-dot:currentColor] aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-sidebar"
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
