// Regular payees: who a bank line is to (or from), as a key Splyce can remember where it was booked last time.
// The account's last 4 digits when the statement gives them, else the distinctive words of the name.

import { CHARGE } from "./charges.ts";
import { nameTokens } from "./match.ts";

export interface PayeeLine { description: string; counterparty: string | null; payee_last4?: string | null }

/** null for bank charges and for lines with no usable name. */
export function payeeKey(line: PayeeLine): string | null {
  if (CHARGE.test(line.description)) return null;
  if (line.payee_last4 && /^\d{2,4}$/.test(line.payee_last4)) return `acct:${line.payee_last4}`;
  const words = nameTokens(line.counterparty).sort();
  return words.length ? `name:${words.join("-")}` : null;
}

/** Last 4 digits of an account number as Wise prints it ("(80017) 1450017035466" → "5466"). */
export function last4(account: string | null | undefined): string | null {
  const digits = (account ?? "").split(/\s+/).at(-1)?.replace(/\D/g, "") ?? "";
  return digits.length >= 4 ? digits.slice(-4) : null;
}
