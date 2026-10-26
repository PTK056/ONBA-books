import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The day each villa went on the market: its first booked night. Before that it could not be
 * occupied, so those days don't count as available (a lease can start months before the first guest).
 */
export async function openingDays(db: SupabaseClient, organizationId: string): Promise<Map<string, string>> {
  const { data } = await db.from("stays").select("villa_id, check_in")
    .eq("organization_id", organizationId).order("check_in").limit(5000);
  const first = new Map<string, string>();
  for (const s of data ?? []) if (!first.has(s.villa_id)) first.set(s.villa_id, s.check_in);
  return first;
}

/** Nights a villa could be booked in a month (YYYY-MM): none before it opened, part of its opening month. */
export function availableNights(month: string, openedOn: string | undefined): number {
  if (!openedOn) return 0;
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const opened = openedOn.slice(0, 7);
  if (month.slice(0, 7) < opened) return 0;
  if (month.slice(0, 7) > opened) return days;
  return days - Number(openedOn.slice(8, 10)) + 1;
}
