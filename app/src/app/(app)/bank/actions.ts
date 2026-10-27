"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { autoMatch, CHARGE, ingestStatement } from "@/lib/bank/ops";
import { readStatementPdf, StatementError } from "@/lib/bank/statement-pdf";
import { getCurrentOrg } from "@/lib/org";
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

/** The browser has put the PDF in the bank bucket; read it, store its lines, link what is obvious. */
export async function addStatement(file: { path: string; name: string; mimeType: string }): Promise<Result> {
  const org = await admin();
  if (!org) return { ok: false, error: "Only admins can add bank statements." };
  if (!file.path.startsWith(`${org.id}/`) || file.mimeType !== "application/pdf") return { ok: false, error: "Unknown file." };
  const db = await createClient();

  const { data: granted } = await db.rpc("ai_take", { org: org.id, k: "bank_statement", wanted: 1 });
  if (!granted) return { ok: false, error: "This month's statement reading allowance is used up; it renews on the 1st." };

  const { data: blob, error: dlErr } = await db.storage.from("bank").download(file.path);
  if (dlErr || !blob) return { ok: false, error: "The file could not be opened. Try again." };
  let statement;
  try {
    statement = await readStatementPdf(new Anthropic(), Buffer.from(await blob.arrayBuffer()).toString("base64"));
  } catch (e) {
    console.error("[bank] read:", e);
    await db.storage.from("bank").remove([file.path]);
    return { ok: false, error: e instanceof StatementError ? e.message : "The statement could not be read. Try again in a minute." };
  }
  if (!statement.lines.length) {
    await db.storage.from("bank").remove([file.path]);
    return { ok: false, error: "No transactions were found in this file. Is it a bank statement?" };
  }

  try {
    const r = await ingestStatement(db, org.id, statement, file);
    const matched = await autoMatch(db, org.id, org.reportingCurrency);
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

/** Books a line that is at the bank but not in the books. */
export async function createFromLine(lineId: string, input: { villaId: string; categoryId: string | null; description: string; fxRate: number | null }): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(lineId)) return { ok: false, error: "Not allowed." };
  if (!org.villas.some((v) => v.id === input.villaId)) return { ok: false, error: "Choose a villa." };
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
  revalidatePath("/transactions");
  revalidatePath("/overview");
  return done();
}

/** One expense for the statement's fees and tax, one income for its interest. */
export async function bookCharges(statementId: string, villaId: string): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(statementId)) return { ok: false, error: "Not allowed." };
  if (!org.villas.some((v) => v.id === villaId)) return { ok: false, error: "Choose a villa." };
  const db = await createClient();
  const [{ data: lines }, { data: cats }] = await Promise.all([
    db.from("bank_lines").select("id, date, direction, amount, currency, description")
      .eq("statement_id", statementId).eq("organization_id", org.id).eq("status", "unmatched"),
    db.from("categories").select("id, name, kind").eq("organization_id", org.id).is("archived_at", null),
  ]);
  const charges = (lines ?? []).filter((l) => CHARGE.test(l.description));
  if (!charges.length) return { ok: false, error: "No bank charges left on this statement." };
  const currency = charges[0].currency;
  if (currency !== org.reportingCurrency) return { ok: false, error: "Book these one by one: they are not in your reporting currency." };
  const category = (kind: "income" | "expense", re: RegExp) => (cats ?? []).find((c) => c.kind === kind && re.test(c.name))?.id ?? null;
  const month = charges.map((l) => l.date).sort().at(-1)!.slice(0, 7);

  for (const direction of ["out", "in"] as const) {
    const group = charges.filter((l) => l.direction === direction);
    if (!group.length) continue;
    const total = Math.round(group.reduce((s, l) => s + Number(l.amount), 0) * 100) / 100;
    const { data: tx, error } = await db.from("transactions").insert({
      organization_id: org.id, villa_id: villaId, date: group.map((l) => l.date).sort().at(-1), direction,
      category_id: direction === "out" ? category("expense", /bank/i) : category("income", /interest|other income/i),
      description: direction === "out" ? `Bank fees and tax, ${month} (${group.length} lines)` : `Bank interest, ${month}`,
      currency, amount: total, fx_rate: 1, status: "validated", source: "module",
    }).select("id").single();
    if (error || !tx) return { ok: false, error: error?.message.includes("closed") ? "That month is closed for this villa." : "Could not save. Try again." };
    await db.from("bank_lines").update({ status: "matched", transaction_id: tx.id, matched_by: "created" }).in("id", group.map((l) => l.id));
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
  return error ? { ok: false, error: "Could not link. Try again." } : done();
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
