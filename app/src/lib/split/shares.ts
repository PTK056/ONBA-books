// Splitting an amount between villas (or anything else) to the cent, so the shares always add up to it.

/** Splits an amount in equal shares to the cent; the cents left over go to the first shares. */
export function equalShares(amount: number, n: number): number[] {
  const cents = Math.round(amount * 100);
  const base = Math.floor(cents / n);
  return Array.from({ length: n }, (_, i) => (base + (i < cents - base * n ? 1 : 0)) / 100);
}

/** Splits an amount by weights (nights, percentages…) to the cent; the cents left over go to the largest shares. */
export function weightedShares(amount: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (!(total > 0)) return equalShares(amount, weights.length);
  const cents = Math.round(amount * 100);
  const exact = weights.map((w) => (cents * w) / total);
  const out = exact.map(Math.floor);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < cents - out.reduce((s, c) => s + c, 0); k++) out[order[k][1]]++;
  return out.map((c) => c / 100);
}
