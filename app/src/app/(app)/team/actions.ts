"use server";

import { revalidatePath } from "next/cache";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import {
  createStaff, deleteLog, logWork, markPaid, preparePayroll, StaffError, updateStaff, type LogInput, type StaffInput,
} from "@/lib/staff/ops";

export type Result = { ok: true } | { ok: false; error: string };

/** Runs a staff operation for an admin or staff user of the current organization. */
async function run(fn: (db: Awaited<ReturnType<typeof createClient>>, orgId: string) => Promise<unknown>): Promise<Result> {
  const org = await getCurrentOrg();
  if (org.kind !== "member" || org.role === "owner_viewer") return { ok: false, error: "Only admins and staff can do this." };
  try {
    await fn(await createClient(), org.id);
  } catch (e) {
    if (e instanceof StaffError) return { ok: false, error: e.message };
    console.error("[team]", e);
    return { ok: false, error: "Something went wrong. Try again." };
  }
  revalidatePath("/team");
  return { ok: true };
}

export async function saveStaff(id: string | null, input: StaffInput) {
  return run((db, org) => (id ? updateStaff(db, org, id, input) : createStaff(db, org, input)));
}

export async function addWork(input: LogInput) {
  return run((db, org) => logWork(db, org, input));
}

export async function removeWork(id: string) {
  return run((db, org) => deleteLog(db, org, id));
}

export async function prepare(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: "Unknown month." } as Result;
  return run((db, org) => preparePayroll(db, org, month));
}

export async function pay(runId: string, paidOn: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { ok: false, error: "Give the payment date." } as Result;
  const r = await run((db, org) => markPaid(db, org, runId, paidOn));
  if (r.ok) { revalidatePath("/transactions"); revalidatePath("/overview"); }
  return r;
}
