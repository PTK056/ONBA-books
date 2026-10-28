"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { autoMatch, CHARGE, ingestStatement, INTEREST, learnPayees, WITHHELD_TAX } from "@/lib/bank/ops";
import { readStatementPdf, StatementError } from "@/lib/bank/statement-pdf";
import { parseWiseCsv, WiseCsvError } from "@/lib/bank/wise-csv";
import { equalShares } from "@/lib/split/shares";
import { getCurrentOrg, places } from "@/lib/org";
import { bankSettings, type Bearer } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: true; message?: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function admin() {
  const org = await getCurrentOrg();
  return org.kind === "member" && org.role === "admin" ? org : null;
}

function done(message?: string): Result {
  revalidatePath("/bank");
  return { ok: true, message };
}

/** The browser has put the statement (PDF, or Wise CSV) in the bank bucket; read it, store its lines, link what is obvious. */
export async function addStatement(file: { path: string; name: string; mimeType: string }): Promise<Result> {
  const org = await admin();
  if (!org) return { ok: false, error: "Only admins can add bank statements." };
  const csv = file.mimeType === "text/csv";
  if (!file.path.startsWith(`${org.id}/`) || !(csv || file.mimeType === "application/pdf")) return { ok: false, error: "Unknown file." };
  const db = await createClient();

  // A PDF is read by Claude and counts against the monthly allowance; a Wise CSV is read as it is.
  if (!csv) {
    const { data: granted } = await db.rpc("ai_take", { org: org.id, k: "bank_statement", wanted: 1 });
    if (!granted) return { ok: false, error: "This month's statement reading allowance is used up; it renews on the 1st." };
  }

  const { data: blob, error: dlErr } = await db.storage.from("bank").download(file.path);
  if (dlErr || !blob) return { ok: false, error: "The file could not be opened. Try again." };
  let statement;
  try {
    statement = csv
      ? parseWiseCsv(await blob.text(), file.name)
      : await readStatementPdf(new Anthropic(), Buffer.from(await blob.arrayBuffer()).toString("base64"));
  } catch (e) {
    console.error("[bank] read:", e);
    await db.storage.from("bank").remove([file.path]);
    const known = e instanceof StatementError || e instanceof WiseCsvError;
    return { ok: false, error: known ? (e as Error).message : "The statement could not be read. Try again in a minute." };
  }
  if (!statement.lines.length) {
    await db.storage.from("bank").remove([file.path]);
    return { ok: false, error: "No transactions were found in this file. Is it a bank statement?" };
  }

  try {
    const r = await ingestStatement(db, org.id, statement, file);
    const matched = await autoMatch(db, org.id, org.reportingCurrency);
    await learnPayees(db, org.id);
    const parts = [`${r.added} line${r.added === 1 ? "" : "s"} added`];
    if (r.skipped) parts.push(`${r.skipped} already known`);
    parts.push(`${matched} matched with your books`);
    if (statement.balanced === false) parts.push("the balances don't add up: check the lines against the PDF");
    return done(parts.join(", ") + ".");
  } catch (e) {
    console.error("[bank] store:", e);
    return { ok: false, error: "The statement was read but could not be saved. Try again." };
  }
}

/** Runs the automatic matching again on every line still to do (after entries were added, or the rules improved). */
export async function matchAgain(): Promise<Result> {
  const org = await admin();
  if (!org) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  const matched = await autoMatch(db, org.id, org.reportingCurrency);
  await learnPayees(db, org.id);
  return done(matched ? `${matched} more line${matched === 1 ? "" : "s"} matched.` : "Nothing new to match.");
}

/** Books a line that is at the bank but not in the books. */
export async function createFromLine(lineId: string, input: { villaId: string; categoryId: string | null; description: string; fxRate: number | null }): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(lineId)) return { ok: false, error: "Not allowed." };
  if (!places(org).some((v) => v.id === input.villaId)) return { ok: false, error: "Choose a villa." };
  const db = await createClient();
  const { data: line } = await db.from("bank_lines").select("id, date, direction, amount, currency, status")
    .eq("id", lineId).eq("organization_id", org.id).single();
  if (!line || line.status !== "unmatched") return { ok: false, error: "This line was already handled." };
  const fx = line.currency === org.reportingCurrency ? 1 : input.fxRate;
  if (!fx || !(fx > 0)) return { ok: false, error: `Enter the ${line.currency} → ${org.reportingCurrency} rate.` };

  const { data: tx, error } = await db.from("transactions").insert({
    organization_id: org.id, villa_id: input.villaId, date: line.date, direction: line.direction,
    category_id: input.categoryId, description: input.description.trim() || null,
    currency: line.currency, amount: line.amount, fx_rate: fx, status: "validated", source: "module",
  }).select("id").single();
  if (error || !tx) return { ok: false, error: error?.message.includes("closed") ? "That month is closed for this villa." : "Could not save. Try again." };
  await db.from("bank_lines").update({ status: "matched", transaction_id: tx.id, matched_by: "created" }).eq("id", lineId);
  await learnPayees(db, org.id);
  revalidatePath("/transactions");
  revalidatePath("/overview");
  return done();
}

/**
 * One expense for the statement's bank fees, and one income for its interest net of the tax the bank withheld
 * (in Indonesia a 20% final tax: not a bank fee, and not a deductible expense).
 */
export async function bookCharges(statementId: string): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(statementId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  const [{ data: lines }, { data: cats }, settings] = await Promise.all([
    db.from("bank_lines").select("id, date, direction, amount, currency, description")
      .eq("statement_id", statementId).eq("organization_id", org.id).eq("status", "unmatched"),
    db.from("categories").select("id, name, kind").eq("organization_id", org.id).is("archived_at", null),
    bankSettings(db, org.id),
  ]);
  // Where each kind goes, as set in Settings: the company, or every villa in equal shares.
  const targets = (to: Bearer) => (to === "company" && org.company ? [org.company] : org.villas);
  const charges = (lines ?? []).filter((l) => CHARGE.test(l.description));
  if (!charges.length) return { ok: false, error: "No bank charges left on this statement." };
  if (charges.some((l) => l.currency !== org.reportingCurrency)) {
    return { ok: false, error: "Book these one by one: they are not in your reporting currency." };
  }
  const category = (kind: "income" | "expense", re: RegExp) => (cats ?? []).find((c) => c.kind === kind && re.test(c.name))?.id ?? null;
  const total = (xs: typeof charges) => Math.round(xs.reduce((s, l) => s + Number(l.amount), 0) * 100) / 100;
  const fmt = (n: number) => n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // One entry per place; split in equal shares when it goes to several villas. The lines link to the first share.
  const book = async (group: typeof charges, to: Bearer, entry: { direction: "in" | "out"; amount: number; category_id: string | null; description: string }) => {
    if (!group.length || !(entry.amount > 0)) return null;
    const where = targets(to);
    const shares = equalShares(entry.amount, where.length);
    const { data: txs, error } = await db.from("transactions").insert(where.map((v, i) => ({
      organization_id: org.id, villa_id: v.id, date: group.map((l) => l.date).sort().at(-1), currency: org.reportingCurrency,
      fx_rate: 1, status: "validated", source: "module", ...entry, amount: shares[i],
      description: where.length > 1 ? `${entry.description} (share ${i + 1}/${where.length})` : entry.description,
    }))).select("id");
    if (error || !txs?.length) return error?.message.includes("closed") ? "That month is closed." : "Could not save. Try again.";
    await db.from("bank_lines").update({ status: "matched", transaction_id: txs[0].id, matched_by: "created" }).in("id", group.map((l) => l.id));
    return null;
  };

  // One booking per month: an export can cover many months (a Wise CSV), and each month's charges belong to it.
  const problems: (string | null)[] = [];
  for (const month of [...new Set(charges.map((l) => l.date.slice(0, 7)))].sort()) {
    const monthCharges = charges.filter((l) => l.date.startsWith(month));
    const interest = monthCharges.filter((l) => l.direction === "in" && INTEREST.test(l.description));
    const tax = monthCharges.filter((l) => l.direction === "out" && WITHHELD_TAX.test(l.description));
    const fees = monthCharges.filter((l) => !interest.includes(l) && !tax.includes(l) && l.direction === "out");
    problems.push(await book(fees, settings.feesTo, {
      direction: "out", amount: total(fees), category_id: category("expense", /bank/i),
      description: `Bank fees, ${month} (${fees.length} line${fees.length === 1 ? "" : "s"})`,
    }));
    const gross = total(interest), withheld = total(tax);
    if (interest.length) {
      problems.push(await book([...interest, ...tax], settings.interestTo, {
        direction: "in", amount: Math.round((gross - withheld) * 100) / 100, category_id: category("income", /interest|other income/i),
        description: withheld ? `Bank interest, ${month}: ${fmt(gross)} less ${fmt(withheld)} tax withheld` : `Bank interest, ${month}`,
      }));
    } else if (tax.length) {
      // Tax without interest on this statement: book it on its own, as a tax.
      problems.push(await book(tax, settings.interestTo, {
        direction: "out", amount: withheld, category_id: category("expense", /tax/i), description: `Tax withheld by the bank, ${month}`,
      }));
    }
  }
  // A closed month keeps its lines in the list; the other months are booked.
  const problem = problems.find(Boolean);
  if (problem) {
    revalidatePath("/transactions");
    return { ok: false, error: `${problem} Months that could be booked were.` };
  }
  revalidatePath("/transactions");
  revalidatePath("/overview");
  return done();
}

/** Links a line to an entry already in the books, chosen by the user. */
export async function linkLine(lineId: string, transactionId: string): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(lineId) || !UUID.test(transactionId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  const { error } = await db.from("bank_lines").update({ status: "matched", transaction_id: transactionId, matched_by: "manual" })
    .eq("id", lineId).eq("organization_id", org.id).eq("status", "unmatched");
  if (error) return { ok: false, error: "Could not link. Try again." };
  await learnPayees(db, org.id);
  return done();
}

/** Links an incoming transfer to the stay it pays (a deposit, the balance, an extension); the income is already booked. */
export async function linkStay(lineId: string, stayId: string): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(lineId) || !UUID.test(stayId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  const { data: line } = await db.from("bank_lines").select("status, direction").eq("id", lineId).eq("organization_id", org.id).single();
  if (!line || line.status !== "unmatched" || line.direction !== "in") return { ok: false, error: "This line was already handled." };
  const { error } = await db.from("bank_line_stays").insert({ organization_id: org.id, line_id: lineId, stay_id: stayId });
  if (error) return { ok: false, error: "Could not link. Try again." };
  await db.from("bank_lines").update({ status: "matched", matched_by: "manual" }).eq("id", lineId);
  return done();
}

export async function markPersonal(lineId: string): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(lineId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  await db.from("bank_lines").update({ status: "personal" }).eq("id", lineId).eq("organization_id", org.id).eq("status", "unmatched");
  return done();
}

/** Puts a line back in the list. An entry created from it stays in the books (delete it from Transactions if wrong). */
export async function resetLine(lineId: string): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(lineId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  await db.from("bank_line_stays").delete().eq("line_id", lineId).eq("organization_id", org.id);
  await db.from("bank_lines").update({ status: "unmatched", transaction_id: null, matched_by: null }).eq("id", lineId).eq("organization_id", org.id);
  return done();
}
