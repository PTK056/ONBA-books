// Amount formatting and parsing for the review form.

// Currencies written without cents. Fixed here rather than read from Intl, whose data
// differs between Node and browsers (Node says 2 for IDR, Chrome says 0), which made the
// server and the browser render different text.
const NO_CENTS = new Set(["IDR", "JPY", "KRW", "VND", "CLP", "ISK", "PYG", "UGX", "XAF", "XOF"]);

/** Minor-unit digits shown for a currency (IDR is written without cents). */
export function fractionDigits(currency: string): number {
  return NO_CENTS.has(currency.toUpperCase()) ? 0 : 2;
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
