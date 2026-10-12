import Link from "next/link";

const LINKS = [
  { href: "/upload", label: "Add receipts" },
  { href: "/review", label: "Review" },
] as const;

export function AppNav({ current, orgName }: { current?: (typeof LINKS)[number]["href"]; orgName?: string }) {
  return (
    <header className="flex items-center gap-4 border-b border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800">
      <span className="font-semibold">{orgName ?? "ONBA Books"}</span>
      <nav className="flex gap-1">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={current === l.href ? "page" : undefined}
            className="rounded px-2 py-1 text-zinc-600 hover:bg-zinc-100 aria-[current=page]:bg-zinc-100 aria-[current=page]:font-medium aria-[current=page]:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:aria-[current=page]:bg-zinc-800 dark:aria-[current=page]:text-zinc-100"
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
