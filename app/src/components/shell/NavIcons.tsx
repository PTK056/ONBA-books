import type { ReactNode } from "react";

/** Splyce's own icons for the main sections: a 1.75 line on a 24 grid and one accent dot, like the wordmark's. */
export type IconProps = { size?: number; className?: string };
export type Section = "overview" | "transactions" | "documents" | "scan" | "review" | "stays" | "team" | "bank" | "performance" | "connections" | "settings";

/** A line icon; the one `<Dot>` takes the accent colour where `--icon-dot` is set, the line colour elsewhere. */
function Line({ size = 24, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}
    >
      {children}
    </svg>
  );
}
const Dot = ({ cx, cy, r = 2 }: { cx: number; cy: number; r?: number }) => (
  <circle cx={cx} cy={cy} r={r} stroke="none" style={{ fill: "var(--icon-dot, currentColor)" }} />
);

export const NAV_ICONS: Record<Section, (p: IconProps) => ReactNode> = {
  performance: (p) => (
    <Line {...p}><path d="M3 20h18M4 16l5-5 4 3 6-7" /><path d="M15 7h4v4" /><Dot cx={19} cy={7} r={2.25} /></Line>
  ),
  overview: (p) => (
    <Line {...p}><rect x="3" y="3" width="9" height="18" rx="2.5" /><rect x="15" y="3" width="6" height="8" rx="2" /><Dot cx={18} cy={17.5} r={2.5} /></Line>
  ),
  transactions: (p) => (
    <Line {...p}><path d="M3 8.5h12M12 5.5l3 3-3 3M21 15.5H9M12 12.5l-3 3 3 3" /><Dot cx={19.5} cy={8.5} /></Line>
  ),
  documents: (p) => (
    <Line {...p}><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" /><Dot cx={16.5} cy={14.5} /></Line>
  ),
  scan: (p) => (
    <Line {...p}>
      <path d="M3 7.5V6a3 3 0 0 1 3-3h1.5M16.5 3H18a3 3 0 0 1 3 3v1.5M21 16.5V18a3 3 0 0 1-3 3h-1.5M7.5 21H6a3 3 0 0 1-3-3v-1.5M8 9h8M8 12.5h8M8 16h4" />
      <Dot cx={15.5} cy={16} r={1.75} />
    </Line>
  ),
  review: (p) => (
    <Line {...p}><rect x="3" y="5.5" width="15" height="15" rx="3.5" /><path d="m7 13 2.5 2.5L14 11" /><Dot cx={19.5} cy={4.5} r={2.5} /></Line>
  ),
  stays: (p) => (
    <Line {...p}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4M7.5 15.5h4" /><Dot cx={16} cy={15.5} /></Line>
  ),
  team: (p) => (
    <Line {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M18 14a6.5 6.5 0 0 1 3.5 6" /><Dot cx={16.5} cy={8} r={2.5} /></Line>
  ),
  bank: (p) => (
    <Line {...p}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h4" /><Dot cx={17} cy={15} r={1.75} /></Line>
  ),
  connections: (p) => (
    <Line {...p}><circle cx="9" cy="12" r="5.5" /><circle cx="15" cy="12" r="5.5" /><Dot cx={12} cy={12} r={1.75} /></Line>
  ),
  settings: (p) => (
    <Line {...p}><path d="M3.5 7h3M12 7h8.5M3.5 17h10M19 17h1.5" /><circle cx="9.25" cy="7" r="2.75" /><Dot cx={16.25} cy={17} r={2.75} /></Line>
  ),
};
