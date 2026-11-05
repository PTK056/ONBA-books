"use server";

import { revalidatePath } from "next/cache";
import { getCurrentOrg } from "@/lib/org";
import { generateReport } from "@/lib/performance/report";
import { createClient } from "@/lib/supabase/server";

// Sply Performance in the app: admins only (the database checks it too: RLS on goals, reports and actions).
// Blocked nights are calendar data: staff may add them as well.

export type Result = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}-01$/;
const validDate = (d: unknown): d is string => typeof d === "string" && DATE.test(d) && !isNaN(Date.parse(d));

async function member(adminOnly: boolean) {
  const org = await getCurrentOrg();
  if (org.kind !== "member") return null;
  if (adminOnly ? org.role !== "admin" : org.role === "owner_viewer") return null;
  return { org, db: await createClient() };
}

const done = (): Result => {
  revalidatePath("/performance");
  return { ok: true };
};

/** Writes (or rewrites) the report of a closed month. */
export async function writeReport(month: string): Promise<Result> {
  if (typeof month !== "string" || !MONTH.test(month)) return { ok: false, error: "Unknown month." };
  const m = await member(true);
  if (!m) return { ok: false, error: "Only an admin can do this." };
  const g = await generateReport(m.db, m.org.id, month);
  if (g.status === "busy") return { ok: false, error: "The report of this month is being written: refresh in a minute." };
  if (g.status === "failed") { revalidatePath("/performance"); return { ok: false, error: g.error ?? "The report could not be written." }; }
  return done();
}

export async function acceptAction(id: string): Promise<Result> {
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "Unknown action." };
  const m = await member(true);
  if (!m) return { ok: false, error: "Only an admin can do this." };
  const { error } = await m.db.rpc("performance_action_accept", { p_action: id });
  if (error) return { ok: false, error: "Could not add it to the tasks." };
  return done();
}

export async function dismissAction(id: string): Promise<Result> {
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "Unknown action." };
  const m = await member(true);
  if (!m) return { ok: false, error: "Only an admin can do this." };
  const { error } = await m.db.from("performance_actions")
    .update({ status: "dismissed", decided_at: new Date().toISOString(), decided_by: (await m.db.auth.getClaims()).data?.claims?.sub ?? null })
    .eq("id", id).eq("organization_id", m.org.id).eq("status", "proposed");
  if (error) return { ok: false, error: "Could not set it aside." };
  return done();
}

export interface GoalInput {
  id?: string;
  label: string; villaId: string | null; since: string; byDate: string;
  target: number; invested: number | null; planned: number; plannedNote: string | null;
}

export async function saveGoal(g: GoalInput): Promise<Result> {
  const m = await member(true);
  if (!m) return { ok: false, error: "Only an admin can do this." };
  const label = typeof g?.label === "string" ? g.label.trim().slice(0, 80) : "";
  if (!label) return { ok: false, error: "Give the goal a name." };
  if (!validDate(g.since) || !validDate(g.byDate) || g.byDate <= g.since) return { ok: false, error: "The goal's date must come after the day it is counted from." };
  const num = (v: unknown, min: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && Math.abs(v) < 1e15 ? v : null);
  const target = num(g.target, -1e15), planned = num(g.planned ?? 0, 0);
  const invested = g.invested === null ? null : num(g.invested, 0.01);
  if (target === null || planned === null || (g.invested !== null && invested === null)) return { ok: false, error: "Check the amounts." };
  const places = [...m.org.villas, ...(m.org.company ? [m.org.company] : [])];
  if (g.villaId !== null && !places.some((p) => p.id === g.villaId)) return { ok: false, error: "Unknown villa." };
  const row = {
    organization_id: m.org.id, label, villa_id: g.villaId, since: g.since, by_date: g.byDate, target, invested, planned,
    planned_note: typeof g.plannedNote === "string" && g.plannedNote.trim() ? g.plannedNote.trim().slice(0, 200) : null,
  };
  const { error } = g.id
    ? UUID.test(g.id) ? await m.db.from("performance_goals").update(row).eq("id", g.id).eq("organization_id", m.org.id) : { error: { message: "id" } }
    : await m.db.from("performance_goals").insert(row);
  if (error) return { ok: false, error: "Could not save the goal." };
  return done();
}

export async function archiveGoal(id: string): Promise<Result> {
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "Unknown goal." };
  const m = await member(true);
  if (!m) return { ok: false, error: "Only an admin can do this." };
  const { error } = await m.db.from("performance_goals").update({ archived_at: new Date().toISOString() }).eq("id", id).eq("organization_id", m.org.id);
  if (error) return { ok: false, error: "Could not remove the goal." };
  return done();
}

export async function addBlock(b: { villaId: string; start: string; end: string; reason: "owner" | "works" | "other"; note: string | null }): Promise<Result> {
  const m = await member(false);
  if (!m) return { ok: false, error: "Only staff and admins can do this." };
  if (!m.org.villas.some((v) => v.id === b?.villaId)) return { ok: false, error: "Choose a villa." };
  if (!validDate(b.start) || !validDate(b.end) || b.end <= b.start) return { ok: false, error: "The last day must come after the first." };
  if (!["owner", "works", "other"].includes(b.reason)) return { ok: false, error: "Unknown reason." };
  const { error } = await m.db.from("villa_blocks").insert({
    organization_id: m.org.id, villa_id: b.villaId, starts_on: b.start, ends_on: b.end, reason: b.reason,
    note: typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 200) : null,
  });
  if (error) return { ok: false, error: "Could not save these nights (a year at most)." };
  return done();
}

export async function deleteBlock(id: string): Promise<Result> {
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "Unknown block." };
  const m = await member(false);
  if (!m) return { ok: false, error: "Only staff and admins can do this." };
  const { error } = await m.db.from("villa_blocks").delete().eq("id", id).eq("organization_id", m.org.id);
  if (error) return { ok: false, error: "Could not remove it." };
  return done();
}
