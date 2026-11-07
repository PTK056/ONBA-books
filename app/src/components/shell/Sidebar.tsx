"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Logo } from "./Logo";
import { NAV_ICONS as I } from "./NavIcons";

// Five sections for every day, two for settings at the bottom. Each section may span several pages (its views):
// `match` lists them, so the section stays highlighted on each.
const NAV = [
  { href: "/overview", label: "Overview", icon: I.overview, match: ["/overview", "/performance"] },
  { href: "/transactions", label: "Transactions", icon: I.transactions, match: ["/transactions", "/documents"] },
  { href: "/review", label: "Receipts", icon: I.scan, match: ["/review", "/upload"], badge: true },
  { href: "/bank", label: "Bank", icon: I.bank, match: ["/bank"], adminOnly: true },
  { href: "/team", label: "Team", icon: I.team, match: ["/team"] },
] as const;

const SETUP = [
  { href: "/connections", label: "Connections", icon: I.connections, match: ["/connections", "/import"], adminOnly: true },
  { href: "/settings", label: "Settings", icon: I.settings, match: ["/settings"], adminOnly: true },
] as const;

interface Props {
  org: React.ReactNode;
  reviewBadge: React.ReactNode;
  user: React.ReactNode;
  /** The villa chooser, under the organization (and in the top bar on small screens). */
  place?: React.ReactNode;
  placeCompact?: React.ReactNode;
  /** Shows the admin-only pages (Connections, Settings; Bank with its module). */
  admin?: boolean;
  /** The optional Bank module is on. */
  bank?: boolean;
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
export function SidebarView({ org, reviewBadge, user, path, admin, bank, place, placeCompact }: Props & { path: string | null }) {
  const on = (href: string) => path !== null && (path === href || path.startsWith(`${href}/`));
  const active = (match: readonly string[]) => match.some(on);
  const nav = NAV.filter((item) => (admin || !("adminOnly" in item)) && (item.href !== "/bank" || bank));
  const setup = SETUP.filter(() => admin);
  const link = "group flex items-center gap-2.5 rounded-full px-3 py-2 text-sm text-white/70 [--icon-dot:var(--color-accent)] aria-[current=page]:[--icon-dot:currentColor] hover:bg-white/5 hover:text-white aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-sidebar";

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
          {nav.map(({ href, label, icon: Icon, match, ...rest }) => (
            <Link key={href} href={href} aria-current={active(match) ? "page" : undefined} className={link}>
              <Icon size={17} className="text-white/50 group-aria-[current=page]:text-sidebar" />
              <span className="flex-1">{label}</span>
              {"badge" in rest && reviewBadge}
            </Link>
          ))}
        </nav>
        {setup.length > 0 && (
          <nav className="mt-auto flex flex-col gap-0.5 border-t border-white/10 pt-3" aria-label="Setup">
            {setup.map(({ href, label, icon: Icon, match }) => (
              <Link key={href} href={href} aria-current={active(match) ? "page" : undefined} className={link}>
                <Icon size={17} className="text-white/50 group-aria-[current=page]:text-sidebar" />
                <span className="flex-1">{label}</span>
              </Link>
            ))}
          </nav>
        )}
        <div className={`${setup.length ? "mt-3" : "mt-auto"} border-t border-white/10 pt-3`}>{user}</div>
      </aside>

      <header className="dark-surface sticky top-0 z-20 flex h-14 items-center gap-3 bg-sidebar/95 px-4 text-white backdrop-blur lg:hidden">
        <Link href="/overview"><Logo className="text-xl" /></Link>
        {placeCompact}
        <nav className="ml-auto flex gap-1 overflow-x-auto">
          {[...nav, ...setup].map(({ href, label, icon: Icon, match, ...rest }) => (
            <Link
              key={href} href={href} aria-label={label} aria-current={active(match) ? "page" : undefined}
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
