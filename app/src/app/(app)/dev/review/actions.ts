"use server";

import type { AcceptInput, ActionResult } from "@/lib/review/types";

// Stand-ins for the real actions in the dev preview: log and succeed.
export async function fakeAccept(input: AcceptInput): Promise<ActionResult> {
  if (process.env.NODE_ENV !== "development") return { ok: false, error: "Not available" };
  console.log("[dev] accept", input);
  return { ok: true };
}

export async function fakeReject(itemId: string): Promise<ActionResult> {
  if (process.env.NODE_ENV !== "development") return { ok: false, error: "Not available" };
  console.log("[dev] reject", itemId);
  return { ok: true };
}
