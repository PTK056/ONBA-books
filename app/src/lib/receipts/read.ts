"use client";

import { createClient } from "@/lib/supabase/client";

const MAX_CALLS_PER_BATCH = 10; // each call reads up to 20 receipts

export interface ReadResult { read: number; failed: number; remaining: number; quota_reached?: boolean }

/** `unreachable`: at least one batch could not reach the engine at all. `quotaReached`: the month's reading quota is used up. */
export interface ReadSummary extends ReadResult { unreachable: boolean; quotaReached: boolean }

/** Calls the read-receipts Edge Function until each batch is fully read or stops progressing. */
export async function readBatches(batchIds: string[]): Promise<ReadSummary> {
  const db = createClient();
  const total: ReadSummary = { read: 0, failed: 0, remaining: 0, unreachable: false, quotaReached: false };
  for (const batchId of batchIds) {
    let remaining = Infinity;
    for (let i = 0; i < MAX_CALLS_PER_BATCH && remaining > 0; i++) {
      const { data, error } = await db.functions.invoke<ReadResult>("read-receipts", { body: { batch_id: batchId } });
      if (error || !data) {
        if (i === 0) total.unreachable = true;
        break;
      }
      total.read += data.read;
      total.failed += data.failed;
      remaining = data.remaining;
      if (data.quota_reached) total.quotaReached = true;
      if (data.quota_reached || data.read + data.failed === 0) break; // used up, or no progress (e.g. API down): a later call resumes
    }
    if (Number.isFinite(remaining)) total.remaining += remaining;
    if (total.quotaReached) break;
  }
  return total;
}

export const QUOTA_MESSAGE = "This month's receipt reading allowance is used up; it renews on the 1st.";
