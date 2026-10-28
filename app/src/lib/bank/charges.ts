// Bank lines that are charges or interest rather than payments: booked together, never learnt as a payee.

/** Bank charges and interest, booked together rather than line by line. */
export const CHARGE = /\b(FEE|FEES|BIAYA|ADM|ADMIN|CHARGE|TAX|PAJAK|INTEREST|BUNGA)\b/i;
export const INTEREST = /\b(INTEREST|BUNGA)\b/i;
/** Tax the bank withholds on interest (Indonesia: 20% final tax). */
export const WITHHELD_TAX = /\b(TAX|PAJAK)\b/i;
