"use client";

// Dev-only palette switcher. Every screen colours itself through the theme's
// roles (brand-*, accent, on-brand, zinc-*), so overriding those variables on
// :root recolours the whole app live without touching a component.

import { useEffect, useState } from "react";

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
type Scale = readonly [string, string, string, string, string, string, string, string, string, string, string];

interface Palette {
  name: string;
  hint: string;
  swatches: string[];
  brand?: Scale;
  neutral?: Scale;
  accent?: string;
  accentInk?: string;
  buttonInk?: string;
  background?: string;
  foreground?: string;
  /** Extra CSS for things the colour roles don't reach (e.g. a dark sidebar). */
  extra?: string;
}

const PALETTES: Palette[] = [
  { name: "Midnight · Navy, ice, blue + chartreuse", hint: "today", swatches: ["#1b1e4b", "#e4ecf0", "#2d4e9b", "#e2db4b"] },
  {
    name: "Harbor · Navy + honey",
    hint: "the previous look, white sidebar",
    swatches: ["#f6f7f9", "#23466e", "#d9a441"],
    brand: ["#eef3f9", "#dce6f2", "#b9cce4", "#8daacf", "#5e84b5", "#3d6698", "#23466e", "#1c3a5c", "#172f4b", "#12253b", "#0b1726"],
    neutral: ["#f6f7f9", "#eef0f4", "#e1e5ec", "#cbd2dd", "#98a2b3", "#667085", "#4f5a6e", "#3a4456", "#273041", "#142033", "#0b1220"],
    accent: "#d9a441",
    accentInk: "#8a6418",
    background: "#f6f7f9",
    foreground: "#142033",
    extra: `aside, header.dark-surface { background: #fff !important; color: inherit; }
aside .text-white\\/55, aside .text-white\\/50 { color: var(--color-zinc-400) !important; }
aside nav a, header.dark-surface nav a { color: var(--color-zinc-600) !important; }
aside nav a[aria-current=page] { background: var(--color-zinc-100) !important; color: var(--color-zinc-900) !important; }
aside .border-white\\/10 { border-color: var(--color-zinc-200) !important; }`,
  },
  {
    name: "Lagoon · Deep teal + sky",
    hint: "sea blue, white sidebar",
    swatches: ["#f5f8f8", "#0f4c5c", "#6ca8e0"],
    brand: ["#edf6f7", "#d6ecee", "#aed8dd", "#7ebdc5", "#4e9da8", "#2b7f8c", "#0f4c5c", "#0c3f4c", "#0a333e", "#082832", "#04181f"],
    neutral: ["#f5f8f8", "#edf2f2", "#dee6e7", "#c6d2d4", "#93a3a6", "#61737a", "#4b5b61", "#37454a", "#253136", "#12232a", "#0a161b"],
    accent: "#6ca8e0",
    accentInk: "#2f6da8",
    background: "#f5f8f8",
    foreground: "#12232a",
    extra: `aside, header.dark-surface { background: #fff !important; color: inherit; }
aside .text-white\\/55, aside .text-white\\/50 { color: var(--color-zinc-400) !important; }
aside nav a, header.dark-surface nav a { color: var(--color-zinc-600) !important; }
aside nav a[aria-current=page] { background: var(--color-zinc-100) !important; color: var(--color-zinc-900) !important; }
aside .border-white\\/10 { border-color: var(--color-zinc-200) !important; }`,
  },
];

const KEY = "splyce-color-lab";


function css(p: Palette) {
  const lines: string[] = [];
  p.brand?.forEach((v, i) => lines.push(`--color-brand-${SHADES[i]}: ${v};`));
  p.neutral?.forEach((v, i) => lines.push(`--color-zinc-${SHADES[i]}: ${v};`));
  if (p.accent) lines.push(`--color-accent: ${p.accent};`);
  if (p.accentInk) lines.push(`--color-accent-ink: ${p.accentInk};`);
  if (p.buttonInk) lines.push(`--color-on-brand: ${p.buttonInk};`);
  let out = lines.length ? `:root { ${lines.join(" ")} }` : "";
  if (p.extra) out += ` ${p.extra}`;
  if (p.background) {
    out += ` @media (prefers-color-scheme: light) { :root { --background: ${p.background}; --foreground: ${p.foreground}; } }`;
  }
  return out;
}

export default function ColorLab() {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(0);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      // Read after mount: localStorage doesn't exist during the server render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved.pick > 0 && saved.pick < PALETTES.length) setPick(saved.pick);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ pick }));
    } catch {}
  }, [pick]);

  return (
    <>
      <style>{css(PALETTES[pick])}</style>
      <div className="fixed right-4 bottom-4 z-[9999] font-sans text-xs text-zinc-900">
        {open && (
          <div className="mb-2 w-72 bg-white p-3 shadow-xl ring-1 ring-black/10">
            <div className="mb-2 font-semibold">Color lab</div>
            <div className="flex flex-col gap-1.5">
              {PALETTES.map((p, i) => (
                <button
                  key={p.name}
                  onClick={() => setPick(i)}
                  className={`flex items-center gap-3 px-2 py-2 text-left ring-1 ${pick === i ? "ring-2 ring-black" : "ring-black/10"}`}
                >
                  <span className="flex">
                    {p.swatches.map((s) => (
                      <span key={s} className="h-5 w-5 ring-1 ring-black/10" style={{ background: s }} />
                    ))}
                  </span>
                  <span className="flex flex-col">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-zinc-500">{p.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          className="ml-auto block rounded-full bg-black px-3 py-2 font-medium text-white shadow-lg"
        >
          🎨 Colors
        </button>
      </div>
    </>
  );
}
