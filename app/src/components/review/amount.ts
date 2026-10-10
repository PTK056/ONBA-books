// Amount formatting and parsing for the review form.

/** Minor-unit digits shown for a currency (IDR is written without cents). */
export function fractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function formatAmount(value: number, currency: string): string {
  const digits = currency ? fractionDigits(currency) : 2;
  return new Intl.NumberFormat("en", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/**
 * Accepts "150000", "150,000", "150 000" and, for currencies without cents,
 * the Indonesian "150.000" / "1.250.000". Returns null when unreadable.
 */
export function parseAmount(text: string, currency: string): number | null {
  let s = text.trim().replace(/[\s,]/g, "");
  if (!s) return null;
  if (currency && fractionDigits(currency) === 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
