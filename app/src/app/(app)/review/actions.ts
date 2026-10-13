"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { AcceptInput, ActionResult } from "@/lib/review/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RLS and the database functions enforce who may do what; these checks only turn bad
// input into readable messages.
function invalid(input: AcceptInput): string | null {
  if (!UUID.test(input.itemId) || !UUID.test(input.villaId)) return "Choose a villa.";
  if (input.categoryId !== null && !UUID.test(input.categoryId)) return "Choose a category.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || isNaN(Date.parse(input.date))) return "Enter the date.";
  if (!/^[A-Z]{3}$/.test(input.currency)) return "Enter a three-letter currency code.";
  if (!(input.amount > 0) || !Number.isFinite(input.amount)) return "Enter the amount.";
  if (!(input.fxRate > 0) || !Number.isFinite(input.fxRate)) return "Enter the exchange rate.";
  return null;
}

export async function acceptItem(input: AcceptInput): Promise<ActionResult> {
  const problem = invalid(input);
  if (problem) return { ok: false, error: problem };

  const db = await createClient();
  const { error } = await db.rpc("accept_receipt_item", {
    item_id: input.itemId,
    villa_id: input.villaId,
    date: input.date,
    category_id: input.categoryId,
    currency: input.currency,
    amount: input.amount,
    fx_rate: input.fxRate,
    description: input.description.trim() || null,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/review");
  return { ok: true };
}

export async function rejectItem(itemId: string): Promise<ActionResult> {
  if (!UUID.test(itemId)) return { ok: false, error: "Unknown receipt." };
  const db = await createClient();
  const { error } = await db.rpc("reject_receipt_item", { item_id: itemId });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/review");
  return { ok: true };
}

function friendly(message: string) {
  if (message.includes("is closed")) return "That month is closed for this villa. Use a date in an open month.";
  if (message.includes("already")) return "Someone already reviewed this receipt.";
  return "Could not save. Try again.";
}
