"use client";

// Dev-only palette switcher. Every screen colours itself with Tailwind's
// brand-* (brand) and zinc-* (neutrals) classes, which read
// var(--color-brand-600) etc., so overriding those variables on :root
// recolours the whole app live without touching a component.

import { useEffect, useState } from "react";

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

// Lightness per shade follows Tailwind's scales; brand chroma is a share of
// the picked colour's own chroma so the scale keeps its character.
const BRAND_L = [0.979, 0.95, 0.905, 0.845, 0.765, 0.696, 0.596, 0.508, 0.432, 0.378, 0.262];
const BRAND_C = [0.15, 0.3, 0.55, 0.8, 0.95, 1, 0.92, 0.78, 0.62, 0.5, 0.4];
const NEUTRAL_L = [0.985, 0.967, 0.92, 0.871, 0.705, 0.552, 0.442, 0.37, 0.274, 0.21, 0.141];

const BRANDS = [
  { name: "V3 emerald (today)", hex: "" },
  { name: "Teal", hex: "#0d9488" },
  { name: "Forest", hex: "#2f6b4f" },
  { name: "Sage", hex: "#6b8f71" },
  { name: "Ocean", hex: "#1f6f8b" },
  { name: "Indigo", hex: "#4f46e5" },
  { name: "Ink", hex: "#1e3a5f" },
  { name: "Terracotta", hex: "#c2562f" },
  { name: "Clay", hex: "#a8643f" },
  { name: "Plum", hex: "#7a3e65" },
];

// Neutrals as a tint: hue and a small chroma applied to every grey.
const NEUTRALS = [
  { name: "V3 warm (today)", hue: -1, chroma: 0 },
  { name: "Pure grey", hue: 0, chroma: 0 },
  { name: "Stone (warm)", hue: 60, chroma: 0.008 },
  { name: "Sand", hue: 80, chroma: 0.014 },
  { name: "Slate (cool)", hue: 255, chroma: 0.02 },
  { name: "Green-grey", hue: 160, chroma: 0.012 },
];

type State = { brand: string; neutral: number };
const KEY = "splyce-color-lab";

function css({ brand, neutral }: State) {
  const lines: string[] = [];
  if (brand) {
    SHADES.forEach((s, i) => {
      lines.push(`--color-brand-${s}: oklch(from ${brand} ${BRAND_L[i]} calc(c * ${BRAND_C[i]}) h);`);
    });
  }
  const n = NEUTRALS[neutral];
  if (n && n.hue >= 0) {
    SHADES.forEach((s, i) => {
      lines.push(`--color-zinc-${s}: oklch(${NEUTRAL_L[i]} ${n.chroma} ${n.hue});`);
    });
    lines.push(`--background: oklch(0.975 ${n.chroma * 0.6} ${n.hue});`);
    lines.push(`--foreground: oklch(0.21 ${n.chroma} ${n.hue});`);
  }
  if (!lines.length) return "";
  let out = `:root { ${lines.join(" ")} }`;
  if (n && n.hue >= 0) {
    out += ` @media (prefers-color-scheme: dark) { :root { --background: oklch(0.141 ${n.chroma} ${n.hue}); --foreground: oklch(0.967 ${n.chroma * 0.5} ${n.hue}); } }`;
  }
  return out;
}

export default function ColorLab() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ brand: "", neutral: 0 });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      // Read after mount: localStorage doesn't exist during the server render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setState(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  const brandName = BRANDS.find((b) => b.hex === state.brand)?.name ?? "Custom";

  return (
    <>
      <style>{css(state)}</style>
      <div className="fixed right-4 bottom-4 z-[9999] font-sans text-xs text-zinc-900">
        {open && (
          <div className="mb-2 w-72 rounded-xl bg-white p-3 shadow-xl ring-1 ring-black/10">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">Color lab</span>
              <button
                className="text-zinc-500 hover:text-zinc-900"
                onClick={() => setState({ brand: "", neutral: 0 })}
              >
                Reset
              </button>
            </div>

            <div className="mb-1 text-zinc-500">Brand · {brandName}</div>
            <div className="mb-2 grid grid-cols-5 gap-1.5">
              {BRANDS.map((b) => (
                <button
                  key={b.name}
                  title={b.name}
                  onClick={() => setState((s) => ({ ...s, brand: b.hex }))}
                  className={`h-8 rounded-md ring-offset-2 ${state.brand === b.hex ? "ring-2 ring-black" : ""}`}
                  style={{ background: b.hex || "#064e3b" }}
                />
              ))}
            </div>
            <label className="mb-3 flex items-center gap-2">
              <input
                type="color"
                value={state.brand || "#064e3b"}
                onChange={(e) => setState((s) => ({ ...s, brand: e.target.value }))}
                className="h-7 w-10 cursor-pointer"
              />
              <span className="font-mono">{state.brand || "#064e3b"}</span>
            </label>

            <div className="mb-1 text-zinc-500">Neutrals</div>
            <div className="grid grid-cols-2 gap-1.5">
              {NEUTRALS.map((n, i) => (
                <button
                  key={n.name}
                  onClick={() => setState((s) => ({ ...s, neutral: i }))}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left ring-1 ${state.neutral === i ? "ring-2 ring-black" : "ring-black/10"}`}
                >
                  <span
                    className="h-4 w-4 rounded-full"
                    style={{ background: n.hue < 0 ? "#6b6f68" : `oklch(0.552 ${n.chroma * 2} ${n.hue})` }}
                  />
                  {n.name}
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
