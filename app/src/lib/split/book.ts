import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { weightedShares } from "./shares";

/** How a shared expense is divided between villas. */
export interface Split {
  villaIds: string[];
  mode: "equal" | "nights" | "percent";
  /** Same order as villaIds; mode "percent" only, adding up to 100. */
  percents?: number[];
}

export class SplitError extends Error {}

/** The amount of each villa's share, in the order of split.villaIds. */
export async function splitAmounts(db: SupabaseClient, orgId: string, amount: number, date: string, split: Split): Promise<number[]> {
  if (split.villaIds.length < 2) throw new SplitError("Choose at least two villas to split between.");
  if (split.mode === "equal") return weightedShares(amount, split.villaIds.map(() => 1));
  if (split.mode === "percent") {
    const p = split.percents ?? [];
    if (p.length !== split.villaIds.length || p.some((x) => !(x >= 0)) || Math.abs(p.reduce((s, x) => s + x, 0) - 100) > 0.01) {
      throw new SplitError("The percentages must add up to 100.");
    }
    return weightedShares(amount, p);
  }
  const nights = await nightsInMonth(db, orgId, split.villaIds, date.slice(0, 7));
  if (!nights.some((n) => n > 0)) throw new SplitError(`No nights booked in these villas in ${date.slice(0, 7)}. Split equally or by percentage.`);
  return weightedShares(amount, nights);
}

/** Nights booked in each villa during a month (YYYY-MM), counted from the stays. */
export async function nightsInMonth(db: SupabaseClient, orgId: string, villaIds: string[], month: string): Promise<number[]> {
  const from = `${month}-01`;
  const to = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)).toISOString().slice(0, 10);
  const { data } = await db.from("stays").select("villa_id, check_in, check_out")
    .eq("organization_id", orgId).neq("status", "canceled").in("villa_id", villaIds).lt("check_in", to).gt("check_out", from);
  const day = 86_400_000;
  return villaIds.map((id) => (data ?? []).filter((s) => s.villa_id === id).reduce((n, s) => {
    const start = Math.max(Date.parse(s.check_in), Date.parse(from));
    const end = Math.min(Date.parse(s.check_out), Date.parse(to));
    return n + Math.max(0, Math.round((end - start) / day));
  }, 0));
}
