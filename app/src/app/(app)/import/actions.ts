"use server";

import { revalidatePath } from "next/cache";
import { getCurrentOrg } from "@/lib/org";
import { allocateByNights, parseAirbnbCsv } from "@/lib/stays/airbnb";
import { createClient } from "@/lib/supabase/server";

export interface ImportSummary {
  created: number;
  updated: number;
  unchanged: number;
  conflicts: { code: string; reason: string }[];
  skipped: { code: string; reason: string }[];
}

const MAX_BYTES = 2 * 1024 * 1024;

/** Re-parses the file on the server (the browser preview is only a preview) and imports it. */
export async function importAirbnb(csv: string, villaByListing: Record<string, string>): Promise<ImportSummary | { error: string }> {
  if (csv.length > MAX_BYTES) return { error: "The file is too large." };
  const org = await getCurrentOrg();
  if (org.kind !== "member" || org.role === "owner_viewer") return { error: "Only admins and staff can import stays." };

  const villaIds = new Set(org.villas.map((v) => v.id));
  const parsed = parseAirbnbCsv(csv);
  if (!parsed.stays.length) return { error: parsed.warnings[0] ?? "No stays found in this file." };

  const db = await createClient();
  const { data: lastRates } = await db.from("transactions").select("currency, fx_rate")
    .eq("organization_id", org.id).order("date", { ascending: false }).limit(500);
  const fallbackRate = (currency: string) => lastRates?.find((r) => r.currency === currency)?.fx_rate as number | undefined;

  const summary: ImportSummary = { created: 0, updated: 0, unchanged: 0, conflicts: [], skipped: [] };
  const byVilla = new Map<string, unknown[]>();
  for (const stay of parsed.stays) {
    const villaId = villaByListing[stay.listing];
    if (!villaId || !villaIds.has(villaId)) {
      summary.skipped.push({ code: stay.code, reason: "No villa chosen for this listing" });
      continue;
    }
    // Rate from the stay's currency to the reporting currency: 1 if they match, else the
    // rate Airbnb applied on the payout, else the last rate used in the books.
    const rate = stay.currency === org.reportingCurrency ? 1
      : stay.payoutRates[org.reportingCurrency] ?? fallbackRate(stay.currency);
    if (!rate) {
      summary.skipped.push({ code: stay.code, reason: `No ${stay.currency} → ${org.reportingCurrency} rate` });
      continue;
    }
    byVilla.set(villaId, [...(byVilla.get(villaId) ?? []), {
      code: stay.code,
      guest: stay.guest,
      check_in: stay.checkIn,
      check_out: stay.checkOut,
      currency: stay.currency,
      gross: Math.max(0, stay.gross),
      fees: Math.max(0, stay.fees),
      payout_date: stay.payoutDate,
      lines: allocateByNights(stay, rate),
    }]);
  }

  for (const [villaId, stays] of byVilla) {
    const { data, error } = await db.rpc("import_stays", { p_villa: villaId, p_platform: "airbnb", p_stays: stays });
    if (error) return { error: "The import failed. Nothing was saved for this villa; try again." };
    const r = data as Omit<ImportSummary, "skipped">;
    summary.created += r.created;
    summary.updated += r.updated;
    summary.unchanged += r.unchanged;
    summary.conflicts.push(...r.conflicts.map((c) => ({
      code: c.code,
      reason: c.reason.includes("closed") ? "Touches a closed month" : c.reason,
    })));
  }
  revalidatePath("/overview");
  return summary;
}
