import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bankErrorOf, BankError, type Via } from "./errors";

// Every action on a bank line goes through one database function (migration bank_agent): it locks the line, checks
// it is still to do and writes, so the app, the assistant and the automatic matching never handle a line twice.

export { BankError, type Via } from "./errors";

async function call<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw bankErrorOf(error.message);
  return data as T;
}

/** Add to the books: one entry from the line, linked to it. Returns the entry's id. */
export function bookLine(db: SupabaseClient, lineId: string, input: {
  villaId: string; categoryId: string | null; description: string | null; fxRate: number | null; via: Via; note?: string | null;
}): Promise<string> {
  return call(db, "bank_line_book", {
    p_line: lineId, p_villa: input.villaId, p_category: input.categoryId, p_description: input.description,
    p_fx: input.fxRate, p_via: input.via, p_note: input.note ?? null,
  });
}

export interface GroupEntry {
  villa_id: string; date: string; direction: "in" | "out"; category_id: string | null; description: string;
  currency: string; amount: number; fx_rate: number;
}

/** Several lines booked as one entry, or as shares of one (a month's bank charges). Returns the first entry's id. */
export function bookLines(db: SupabaseClient, lineIds: string[], entries: GroupEntry[], via: Via, note?: string | null): Promise<string> {
  return call(db, "bank_lines_book_group", { p_lines: lineIds, p_entries: entries, p_via: via, p_note: note ?? null });
}

/**
 * Links a line to an entry; with sameAmount the database refuses (amount_mismatch) an entry of another amount. With part,
 * the line may join an entry other lines already pay (several transfers for one purchase), never paying more than it.
 */
export async function linkEntry(
  db: SupabaseClient, lineId: string, transactionId: string, via: Via, note?: string | null, sameAmount = false, part = false,
): Promise<void> {
  await call(db, "bank_line_link", {
    p_line: lineId, p_transaction: transactionId, p_by: via === "auto" ? "auto" : "manual", p_via: via, p_note: note ?? null,
    p_same_amount: sameAmount, p_part: part,
  });
}

export async function linkStays(db: SupabaseClient, lineId: string, stayIds: string[], via: Via, note?: string | null): Promise<void> {
  await call(db, "bank_line_link_stays", {
    p_line: lineId, p_stays: stayIds, p_by: via === "auto" ? "auto" : "manual", p_via: via, p_note: note ?? null,
  });
}

export type PersonalReason = "owner_transfer" | "owner_contribution" | "private_expense" | "internal_transfer" | "returned";

export async function markLinePersonal(db: SupabaseClient, lineId: string, reason: PersonalReason | null, via: Via, note?: string | null): Promise<void> {
  await call(db, "bank_line_personal", { p_line: lineId, p_reason: reason, p_via: via, p_note: note ?? null });
}

/** Several lines that together are exactly one entry no line pays yet (a Wise transfer and its fee): all or none. */
export async function linkLinesToEntry(db: SupabaseClient, lineIds: string[], transactionId: string, via: Via, note?: string | null): Promise<void> {
  await call(db, "bank_lines_link_entry", {
    p_lines: lineIds, p_transaction: transactionId, p_by: via === "auto" ? "auto" : "manual", p_via: via, p_note: note ?? null,
  });
}

/** Lines that cancel each other out (a transfer sent back): set aside together, nothing booked. */
export async function cancelLines(db: SupabaseClient, lineIds: string[], via: Via, note?: string | null): Promise<void> {
  await call(db, "bank_lines_cancel", { p_lines: lineIds, p_via: via, p_note: note ?? null });
}

export interface Undone { was: "matched" | "personal"; transaction_id: string | null; matched_by: string | null; entry_deleted: boolean }

/** Puts a handled line back in the list; with deleteEntry, also deletes the entry created from it when that is safe. */
export function resetLine(db: SupabaseClient, lineId: string, deleteEntry = false): Promise<Undone> {
  return call(db, "bank_line_reset", { p_line: lineId, p_delete_entry: deleteEntry });
}

/** True for the errors that only mean someone else got there first (auto-matching skips those lines quietly). */
export const isRace = (e: unknown) => e instanceof BankError && ["already_handled", "entry_taken"].includes(e.code);
