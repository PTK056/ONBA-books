"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { bookStatementCharges } from "@/lib/bank/book-charges";
import { BankError, bookLine, linkEntry, linkStays, markLinePersonal, resetLine as reset } from "@/lib/bank/handle";
import { autoMatch, ingestStatement, learnPayees, shift } from "@/lib/bank/ops";
import { readStatementPdf, StatementError } from "@/lib/bank/statement-pdf";
import { parseWiseCsv, WiseCsvError } from "@/lib/bank/wise-csv";
import { getCurrentOrg, places } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: true; message?: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function admin() {
  const org = await getCurrentOrg();
  return org.kind === "member" && org.role === "admin" ? org : null;
}

/** The message to show for a failed bank action. */
function failure(e: unknown): string {
  if (!(e instanceof BankError)) {
    console.error("[bank]", e);
    return "Could not save. Try again.";
  }
  return e.code === "already_handled" ? "This line was already handled." : e.message;
}

/** Whether the line belongs to the organization the user is working in (an admin of two must act in the right one). */
async function ours(db: Awaited<ReturnType<typeof createClient>>, orgId: string, lineId: string): Promise<boolean> {
  const { data } = await db.from("bank_lines").select("id").eq("id", lineId).eq("organization_id", orgId).maybeSingle();
  return !!data;
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

  try {
    await bookLine(db, lineId, { villaId: input.villaId, categoryId: input.categoryId, description: input.description, fxRate: fx, via: "app" });
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
  await learnPayees(db, org.id);
  revalidatePath("/transactions");
  revalidatePath("/overview");
  return done();
}

/** Books the statement's bank fees and interest, per month (see lib/bank/book-charges). */
export async function bookCharges(statementId: string): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(statementId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  try {
    const r = await bookStatementCharges(db, org, statementId, "app");
    revalidatePath("/transactions");
    if (r.problem) return { ok: false, error: `${r.problem} Months that could be booked were.` };
    revalidatePath("/overview");
    return done();
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
}

/** Links a line to an entry already in the books, chosen by the user. */
export async function linkLine(lineId: string, transactionId: string): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(lineId) || !UUID.test(transactionId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  if (!(await ours(db, org.id, lineId))) return { ok: false, error: "Not allowed." };
  try {
    await linkEntry(db, lineId, transactionId, "app");
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
  await learnPayees(db, org.id);
  return done();
}

export interface EntryCandidate {
  id: string; date: string; amount: number; currency: string;
  /** In the line's currency, to compare; null when the two currencies cannot be compared. */
  inLineCurrency: number | null;
  villa: string | null; category: string | null; description: string | null;
}

/**
 * Entries this line could be, when the amount or the date is not close enough for a suggestion: an expense booked
 * with the fee included, from a receipt dated weeks before. Same direction, not linked to a bank line yet; the
 * closest amounts first, or those whose description contains the search.
 */
export async function findEntries(lineId: string, search: string): Promise<{ ok: true; entries: EntryCandidate[] } | { ok: false; error: string }> {
  const org = await admin();
  if (!org || !UUID.test(lineId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  const { data: line } = await db.from("bank_lines").select("date, direction, amount, currency, status").eq("id", lineId).eq("organization_id", org.id).single();
  if (!line || line.status !== "unmatched") return { ok: false, error: "This line was already handled." };

  const words = search.trim().slice(0, 60).replace(/[%_,()]/g, " ").trim();
  let q = db.from("transactions")
    .select("id, date, amount, currency, amount_reporting, description, villa:villas (name), category:categories (name)")
    .eq("organization_id", org.id).eq("status", "validated").eq("direction", line.direction).is("stay_id", null)
    .gte("date", shift(line.date, -90)).lte("date", shift(line.date, 30));
  if (words) q = q.ilike("description", `%${words}%`);
  const [{ data: txs }, { data: taken }] = await Promise.all([
    q.limit(500),
    db.from("bank_lines").select("transaction_id").eq("organization_id", org.id).not("transaction_id", "is", null),
  ]);
  const used = new Set((taken ?? []).map((t) => t.transaction_id));
  type Tx = { id: string; date: string; amount: number; currency: string; amount_reporting: number; description: string | null;
    villa: { name: string } | null; category: { name: string } | null };
  const amount = Number(line.amount);
  const days = (d: string) => Math.abs(Date.parse(d) - Date.parse(line.date)) / 86_400_000;
  const entries: EntryCandidate[] = ((txs ?? []) as unknown as Tx[])
    .filter((t) => !used.has(t.id))
    .map((t) => ({ id: t.id, date: t.date, amount: Number(t.amount), currency: t.currency,
      inLineCurrency: t.currency === line.currency ? Number(t.amount) : line.currency === org.reportingCurrency ? Number(t.amount_reporting) : null,
      villa: t.villa?.name ?? null, category: t.category?.name ?? null, description: t.description }));
  // Relative amount gap first (an amount that cannot be compared counts as twice as far); a day apart weighs like 0.5%.
  const score = (e: EntryCandidate) => (e.inLineCurrency === null ? 2 : Math.abs(e.inLineCurrency - amount) / amount) + days(e.date) * 0.005;
  const ranked = entries.sort((a, b) => score(a) - score(b))
    .slice(0, 8);
  return { ok: true, entries: ranked };
}

/** Links an incoming transfer to the stay it pays (a deposit, the balance, an extension); the income is already booked. */
export async function linkStay(lineId: string, stayId: string): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(lineId) || !UUID.test(stayId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  if (!(await ours(db, org.id, lineId))) return { ok: false, error: "Not allowed." };
  try {
    await linkStays(db, lineId, [stayId], "app");
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
  return done();
}

export async function markPersonal(lineId: string): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(lineId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  if (!(await ours(db, org.id, lineId))) return { ok: false, error: "Not allowed." };
  try {
    await markLinePersonal(db, lineId, null, "app");
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
  return done();
}

/** Puts a line back in the list. An entry created from it stays in the books (delete it from Transactions if wrong). */
export async function resetLine(lineId: string): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(lineId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  if (!(await ours(db, org.id, lineId))) return { ok: false, error: "Not allowed." };
  try {
    await reset(db, lineId);
  } catch (e) {
    if (!(e instanceof BankError && e.code === "not_handled")) return { ok: false, error: failure(e) };
  }
  await learnPayees(db, org.id);
  return done();
}
