"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareFile } from "@/components/upload/prepare";

/** Prepares a photo or PDF and stores it in the organization's private evidence folder. */
export async function uploadEvidenceFile(db: SupabaseClient, organizationId: string, file: File) {
  const { blob, mimeType, extension } = await prepareFile(file);
  const path = `${organizationId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await db.storage.from("evidence").upload(path, blob, { contentType: mimeType });
  if (error) throw new Error("Upload failed");
  return { path, mimeType };
}
