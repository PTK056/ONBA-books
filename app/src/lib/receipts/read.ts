"use client";

import { createClient } from "@/lib/supabase/client";

const MAX_CALLS_PER_BATCH = 10; // each call reads up to 20 receipts

export interface ReadResult { read: number; failed: number; remaining: number }

/** `unreachable`: at least one batch could not reach the engine at all. */
export interface ReadSummary extends ReadResult { unreachable: boolean }

/** Calls the read-receipts Edge Function until each batch is fully read or stops progressing. */
export async function readBatches(batchIds: string[]): Promise<ReadSummary> {
  const db = createClient();
  const total: ReadSummary = { read: 0, failed: 0, remaining: 0, unreachable: false };
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
      if (data.read + data.failed === 0) break; // no progress (e.g. API down): a later call resumes
    }
    if (Number.isFinite(remaining)) total.remaining += remaining;
  }
  return total;
}
