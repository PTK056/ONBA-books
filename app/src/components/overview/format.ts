import { fractionDigits } from "@/components/review/amount";

export function money(value: number, currency: string, compact = false): string {
  const digits = fractionDigits(currency);
  return new Intl.NumberFormat("en", compact
    ? { notation: "compact", maximumFractionDigits: 1 }
    : { minimumFractionDigits: digits, maximumFractionDigits: digits },
  ).format(value);
}

export function monthLabel(isoMonth: string, style: "long" | "short" = "long"): string {
  return new Date(`${isoMonth}T00:00:00Z`).toLocaleDateString("en", {
    month: style, ...(style === "long" ? { year: "numeric" } : {}), timeZone: "UTC",
  });
}
