// Errors of the bank actions (migration bank_agent): the database raises "code: message"; a closed month keeps the
// guard's own wording. Pure, so it can be tested without a database.

export type Via = "app" | "agent" | "auto";

export type BankErrorCode =
  | "not_found" | "already_handled" | "not_handled" | "direction_mismatch" | "entry_taken" | "stay_entry" | "amount_mismatch"
  | "invalid_category" | "invalid_entries" | "fx_rate_required" | "cannot_delete" | "month_closed" | "failed";

const CODES: BankErrorCode[] = [
  "not_found", "already_handled", "not_handled", "direction_mismatch", "entry_taken", "stay_entry", "amount_mismatch",
  "invalid_category", "invalid_entries", "fx_rate_required", "cannot_delete",
];

export class BankError extends Error {
  code: BankErrorCode;
  constructor(code: BankErrorCode, message: string) { super(message); this.code = code; }
}

export function bankErrorOf(raw: string): BankError {
  const m = /^([a-z_]+): ([\s\S]*)$/.exec(raw);
  if (m && (CODES as string[]).includes(m[1])) return new BankError(m[1] as BankErrorCode, m[2]);
  if (/month .* is closed/i.test(raw)) return new BankError("month_closed", "That month is closed for this villa. Reopen it, or book the entry in an open month.");
  return new BankError("failed", "Could not save. Try again.");
}
