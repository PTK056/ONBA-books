import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { equalShares } from "@/lib/split/shares";
import { bankSettings, type Bearer } from "@/lib/settings";
import { CHARGE, INTEREST, WITHHELD_TAX } from "./charges";
import { BankError, bookLines, isRace, type Via } from "./handle";

export interface ChargesOrg {
  id: string; reportingCurrency: string; villas: { id: string }[]; company: { id: string } | null;
}

export interface ChargesBooked {
  /** Entries written (one per month and kind; shares of one count as one). */
  booked: number;
  /** Lines linked to them. */
  lines: number;
  /** Why some could not be booked (a closed month); the others were. */
  problem: string | null;
}

/**
 * One expense for the statement's bank fees, and one income for its interest net of the tax the bank withheld
 * (in Indonesia a 20% final tax: not a bank fee, and not a deductible expense), per month. Each booking is one
 * atomic database call, so charges booked meanwhile (by the app or the assistant) are never booked twice.
 */
export async function bookStatementCharges(db: SupabaseClient, org: ChargesOrg, statementId: string, via: Via, note?: string | null): Promise<ChargesBooked> {
  const [{ data: lines }, { data: cats }, settings] = await Promise.all([
    db.from("bank_lines").select("id, date, direction, amount, currency, description")
      .eq("statement_id", statementId).eq("organization_id", org.id).eq("status", "unmatched"),
    db.from("categories").select("id, name, kind").eq("organization_id", org.id).is("archived_at", null),
    bankSettings(db, org.id),
  ]);
  // Where each kind goes, as set in Settings: the company, or every villa in equal shares.
  const targets = (to: Bearer) => (to === "company" && org.company ? [org.company] : org.villas);
  const charges = (lines ?? []).filter((l) => CHARGE.test(l.description));
  if (!charges.length) throw new BankError("not_found", "No bank charges left on this statement.");
  if (charges.some((l) => l.currency !== org.reportingCurrency)) {
    throw new BankError("fx_rate_required", "These charges are not in the reporting currency: add them one by one.");
  }
  const category = (kind: "income" | "expense", re: RegExp) => (cats ?? []).find((c) => c.kind === kind && re.test(c.name))?.id ?? null;
  const total = (xs: typeof charges) => Math.round(xs.reduce((s, l) => s + Number(l.amount), 0) * 100) / 100;
  const fmt = (n: number) => n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const result: ChargesBooked = { booked: 0, lines: 0, problem: null };
  // One entry per place; split in equal shares when it goes to several villas. The lines link to the first share.
  const book = async (group: typeof charges, to: Bearer, entry: { direction: "in" | "out"; amount: number; category_id: string | null; description: string }) => {
    if (!group.length || !(entry.amount > 0)) return;
    const where = targets(to);
    const shares = equalShares(entry.amount, where.length);
    const date = group.map((l) => l.date).sort().at(-1)!;
    try {
      await bookLines(db, group.map((l) => l.id), where.map((v, i) => ({
        villa_id: v.id, date, currency: org.reportingCurrency, fx_rate: 1, ...entry, amount: shares[i],
        description: where.length > 1 ? `${entry.description} (share ${i + 1}/${where.length})` : entry.description,
      })), via, note);
      result.booked++;
      result.lines += group.length;
    } catch (e) {
      result.problem ??= isRace(e) ? "Some of these lines were handled meanwhile: look at the statement again."
        : e instanceof BankError ? e.message : "Could not save. Try again.";
    }
  };

  // One booking per month: an export can cover many months (a Wise CSV), and each month's charges belong to it.
  for (const month of [...new Set(charges.map((l) => l.date.slice(0, 7)))].sort()) {
    const monthCharges = charges.filter((l) => l.date.startsWith(month));
    const interest = monthCharges.filter((l) => l.direction === "in" && INTEREST.test(l.description));
    const tax = monthCharges.filter((l) => l.direction === "out" && WITHHELD_TAX.test(l.description));
    const fees = monthCharges.filter((l) => !interest.includes(l) && !tax.includes(l) && l.direction === "out");
    await book(fees, settings.feesTo, {
      direction: "out", amount: total(fees), category_id: category("expense", /bank/i),
      description: `Bank fees, ${month} (${fees.length} line${fees.length === 1 ? "" : "s"})`,
    });
    const gross = total(interest), withheld = total(tax);
    if (interest.length) {
      await book([...interest, ...tax], settings.interestTo, {
        direction: "in", amount: Math.round((gross - withheld) * 100) / 100, category_id: category("income", /interest|other income/i),
        description: withheld ? `Bank interest, ${month}: ${fmt(gross)} less ${fmt(withheld)} tax withheld` : `Bank interest, ${month}`,
      });
    } else if (tax.length) {
      // Tax without interest on this statement: book it on its own, as a tax.
      await book(tax, settings.interestTo, {
        direction: "out", amount: withheld, category_id: category("expense", /tax/i), description: `Tax withheld by the bank, ${month}`,
      });
    }
  }
  return result;
}
