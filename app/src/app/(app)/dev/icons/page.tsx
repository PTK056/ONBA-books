// Development-only sheet of Splyce's section icons, large on a white card; the sidebar beside it shows them at their real size.
// The dot takes the accent colour through --icon-dot (dark olive on white, where chartreuse is too pale).

import { notFound } from "next/navigation";
import { NAV_ICONS, type Section } from "@/components/shell/NavIcons";

export default function DevIcons() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-8">
      <section className="card grid grid-cols-5 gap-6 p-6 text-brand-600 [--icon-dot:var(--color-accent-ink)] sm:grid-cols-10">
        {(Object.keys(NAV_ICONS) as Section[]).map((s) => {
          const Icon = NAV_ICONS[s];
          return <span key={s} title={s}><Icon size={32} /></span>;
        })}
      </section>
    </main>
  );
}
