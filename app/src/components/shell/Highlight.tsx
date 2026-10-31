/** A page's key figure in a large brand tile, like the Overview's net result. */
export function Highlight({ label, icon, value, unit, note, className = "" }: {
  label: string; icon?: React.ReactNode; value: string; unit?: string; note?: React.ReactNode; className?: string;
}) {
  return (
    <div className={`relative flex flex-col justify-between overflow-hidden rounded-xl bg-brand-600 p-5 text-white ${className}`}>
      <span aria-hidden className="pointer-events-none absolute -right-12 -bottom-16 size-48 rounded-full border-[26px] border-white/[0.06]" />
      <div className="relative flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-white/70">{label}</p>
        {icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-accent">{icon}</span>}
      </div>
      <div className="relative mt-5">
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {value}{unit && <span className="ml-1.5 whitespace-nowrap text-base font-normal text-white/60">{unit}</span>}
        </p>
        {note && <p className="mt-2 text-sm text-white/70">{note}</p>}
      </div>
    </div>
  );
}

/** A small figure card to sit beside a Highlight. */
export function MiniStat({ label, value, unit, children }: { label: string; value: string; unit?: string; children?: React.ReactNode }) {
  return (
    <div className="card flex flex-col justify-between p-4">
      <p className="text-sm text-zinc-500">{label}</p>
      <div className="mt-2">
        <p className="text-xl font-semibold tracking-tight tabular-nums">
          {value}{unit && <span className="ml-1 text-sm font-normal text-zinc-400">{unit}</span>}
        </p>
        {children && <div className="mt-1 text-xs">{children}</div>}
      </div>
    </div>
  );
}
