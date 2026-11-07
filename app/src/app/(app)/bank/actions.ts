"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { acceptSure, decideProposal } from "@/lib/bank/accountant/apply";
import { refreshTelegram, notifyRun, runTitle } from "@/lib/bank/accountant/notify";
import { runAccountant } from "@/lib/bank/accountant/run";
import { bookStatementCharges } from "@/lib/bank/book-charges";
import { BankError, bookLine, cancelLines, linkEntry, linkLinesToEntry, linkStays, markLinePersonal, resetLine as reset, type PersonalReason } from "@/lib/bank/handle";
import { whereIn } from "@/lib/bank/candidates";
import { autoMatch, ingestStatement, learnPayees, shift } from "@/lib/bank/ops";
import { readStatementPdf, StatementError } from "@/lib/bank/statement-pdf";
import { inLineCurrency, partRoom } from "@/lib/bank/suggest";
import { parseWiseCsv, WiseCsvError } from "@/lib/bank/wise-csv";
import { getCurrentOrg, places } from "@/lib/org";
import { clientFor } from "@/lib/mcp/session";
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

/** A note typed by the user: trimmed, at most 500 characters, null when empty. */
function noteOf(note: unknown): string | null {
  return typeof note === "string" ? note.replace(/\s+/g, " ").trim().slice(0, 500) || null : null;
}

/** Whether all these lines belong to the organization (2 to 10 of them). */
async function allOurs(db: Awaited<ReturnType<typeof createClient>>, orgId: string, lineIds: unknown): Promise<string[] | null> {
  if (!Array.isArray(lineIds)) return null;
  const ids = [...new Set(lineIds)];
  if (ids.length < 2 || ids.length > 10 || !ids.every((x) => typeof x === "string" && UUID.test(x))) return null;
  const { data } = await db.from("bank_lines").select("id").eq("organization_id", orgId).in("id", ids);
  return data?.length === ids.length ? ids : null;
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
    // Sply Accountant looks at what is left, after the reply, as the user (their token outlives the request).
    const token = (await db.auth.getSession()).data.session?.access_token;
    if (token) {
      after(async () => {
        try {
          const run = await runAccountant(clientFor(token), org.id, { trigger: "statement", statementId: r.statementId });
          if (run.runId && run.proposed) await notifyRun(org.id, run.runId, await runTitle(org.id, r.statementId));
        } catch (e) {
          console.error("[accountant] after statement:", e);
        }
      });
      parts.push("Sply is looking at the rest");
    }
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
export async function createFromLine(
  lineId: string, input: { villaId: string; categoryId: string | null; description: string; fxRate: number | null; note?: string | null },
): Promise<Result> {
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
    await bookLine(db, lineId, {
      villaId: input.villaId, categoryId: input.categoryId, description: input.description, fxRate: fx, via: "app", note: noteOf(input.note),
    });
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

/** Links a line to an entry; with part, as one more payment of an entry other lines already pay (never more than it). */
export async function linkLine(lineId: string, transactionId: string, part = false, note: string | null = null): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(lineId) || !UUID.test(transactionId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  if (!(await ours(db, org.id, lineId))) return { ok: false, error: "Not allowed." };
  try {
    await linkEntry(db, lineId, transactionId, "app", noteOf(note), false, part === true);
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
  /** Paid in part by other bank lines already: how many, and what is left to pay in the line's currency. */
  paidBy: { lines: number; left: number | null } | null;
}

/** An entry the search found that its bank lines already pay in full (or this line would pay more than is left). */
export interface FullEntry { date: string; description: string | null; lines: number; left: number | null }

/**
 * Entries this line could be, when the amount or the date is not close enough for a suggestion: an expense booked
 * with the fee included, from a receipt dated weeks before, a purchase paid in several transfers. Same direction, not
 * linked to a bank line yet or with room left for this one; the closest amounts first, or those whose description
 * contains the search.
 */
export async function findEntries(lineId: string, search: string): Promise<
  { ok: true; entries: EntryCandidate[]; full: FullEntry[] } | { ok: false; error: string }
> {
  const org = await admin();
  if (!org || !UUID.test(lineId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  const { data: line } = await db.from("bank_lines").select("date, direction, amount, currency, status").eq("id", lineId).eq("organization_id", org.id).single();
  if (!line || line.status !== "unmatched") return { ok: false, error: "This line was already handled." };

  const words = (typeof search === "string" ? search : "").trim().slice(0, 60).replace(/[%_,()]/g, " ").trim();
  let q = db.from("transactions")
    .select("id, date, amount, currency, amount_reporting, description, villa:villas (name), category:categories (name)")
    .eq("organization_id", org.id).eq("status", "validated").eq("direction", line.direction).is("stay_id", null)
    .gte("date", shift(line.date, -90)).lte("date", shift(line.date, 30));
  if (words) q = q.ilike("description", `%${words}%`);
  const { data: txs, error } = await q.order("date", { ascending: false }).limit(500);
  if (error) return { ok: false, error: "Could not search the books. Try again." };
  type Tx = { id: string; date: string; amount: number; currency: string; amount_reporting: number; description: string | null;
    villa: { name: string } | null; category: { name: string } | null };
  const list = (txs ?? []) as unknown as Tx[];
  let taken: { transaction_id: string; amount: number; currency: string }[];
  try {
    taken = await whereIn(db, org.id, "bank_lines", "transaction_id, amount, currency", "transaction_id", list.map((t) => t.id));
  } catch {
    return { ok: false, error: "Could not search the books. Try again." };
  }
  const paidBy = new Map<string, { amount: number; currency: string }[]>();
  for (const x of taken) paidBy.set(x.transaction_id, [...(paidBy.get(x.transaction_id) ?? []), { amount: Number(x.amount), currency: x.currency }]);

  const amount = Number(line.amount);
  const me = { amount, currency: line.currency };
  const days = (d: string) => Math.abs(Date.parse(d) - Date.parse(line.date)) / 86_400_000;
  const entries: EntryCandidate[] = [];
  const full: FullEntry[] = [];
  for (const t of list) {
    const e = { date: t.date, amount: Number(t.amount), currency: t.currency, amountReporting: Number(t.amount_reporting), description: t.description };
    const paid = paidBy.get(t.id);
    const room = paid ? partRoom(me, e, paid, org.reportingCurrency) : null;
    if (paid && !room!.fits) {
      full.push({ date: t.date, description: t.description, lines: paid.length, left: room!.left });
      continue;
    }
    entries.push({ id: t.id, date: t.date, amount: e.amount, currency: t.currency, inLineCurrency: inLineCurrency(me, e, org.reportingCurrency),
      villa: t.villa?.name ?? null, category: t.category?.name ?? null, description: t.description,
      paidBy: paid ? { lines: paid.length, left: room!.left } : null });
  }
  // Relative amount gap first (to what is left, for a part payment; an amount that cannot be compared counts as twice
  // as far); a day apart weighs like 0.5%.
  const compared = (e: EntryCandidate) => (e.paidBy ? e.paidBy.left : e.inLineCurrency);
  const score = (e: EntryCandidate) => {
    const c = compared(e);
    return (c === null ? 2 : Math.abs(c - amount) / amount) + days(e.date) * 0.005;
  };
  return { ok: true, entries: entries.sort((a, b) => score(a) - score(b)).slice(0, 8), full: full.slice(0, 3) };
}

/** Links an incoming transfer to the stay it pays (a deposit, the balance, an extension); the income is already booked. */
export async function linkStay(lineId: string, stayId: string, note: string | null = null): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(lineId) || !UUID.test(stayId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  if (!(await ours(db, org.id, lineId))) return { ok: false, error: "Not allowed." };
  try {
    await linkStays(db, lineId, [stayId], "app", noteOf(note));
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
  return done();
}

/** A line and other lines (its Wise fee) that together are exactly one entry: linked together, or not at all. */
export async function linkWithLines(lineIds: string[], transactionId: string, note: string | null = null): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(transactionId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  const ids = await allOurs(db, org.id, lineIds);
  if (!ids) return { ok: false, error: "Not allowed." };
  try {
    await linkLinesToEntry(db, ids, transactionId, "app", noteOf(note));
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
  await learnPayees(db, org.id);
  return done();
}

/** Lines that cancel each other out (a transfer sent back): set aside together, nothing booked. */
export async function cancelTogether(lineIds: string[], note: string | null = null): Promise<Result> {
  const org = await admin();
  if (!org) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  const ids = await allOurs(db, org.id, lineIds);
  if (!ids) return { ok: false, error: "Not allowed." };
  try {
    await cancelLines(db, ids, "app", noteOf(note));
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
  return done();
}

/** The reasons a person can give: money out to the owner or for them, money in from the owner, between own accounts. */
const PERSONAL: Record<"in" | "out", PersonalReason[]> = {
  out: ["owner_transfer", "private_expense", "internal_transfer"],
  in: ["owner_contribution", "internal_transfer"],
};

export async function markPersonal(lineId: string, reason: PersonalReason | null = null, note: string | null = null): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(lineId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  const { data: line } = await db.from("bank_lines").select("direction").eq("id", lineId).eq("organization_id", org.id).maybeSingle();
  if (!line) return { ok: false, error: "Not allowed." };
  if (reason !== null && !PERSONAL[line.direction as "in" | "out"].includes(reason)) return { ok: false, error: "That reason does not fit this line." };
  try {
    await markLinePersonal(db, lineId, reason, "app", noteOf(note));
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
  return done();
}

/** The owner's own note on a line, still to do or handled; empty removes it. */
export async function saveNote(lineId: string, note: string): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(lineId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  const { data, error } = await db.from("bank_lines").update({ note: noteOf(note) })
    .eq("id", lineId).eq("organization_id", org.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Could not save the note. Try again." };
  return done();
}

export interface StayOption { id: string; guest: string | null; platform: string; reference: string | null; checkIn: string; checkOut: string }

/** Stays an incoming transfer could pay, for the user to choose: by guest name, or the closest arrivals around the line. */
export async function findStays(lineId: string, search: string): Promise<{ ok: true; stays: StayOption[] } | { ok: false; error: string }> {
  const org = await admin();
  if (!org || !UUID.test(lineId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  const { data: line } = await db.from("bank_lines").select("date, direction, status").eq("id", lineId).eq("organization_id", org.id).single();
  if (!line || line.status !== "unmatched") return { ok: false, error: "This line was already handled." };
  if (line.direction !== "in") return { ok: false, error: "Only money in pays a stay." };
  // Letters, digits, spaces and dashes only: the words go inside a PostgREST or() filter.
  const words = (typeof search === "string" ? search : "").slice(0, 60).replace(/[^\p{L}\p{N} -]/gu, " ").replace(/\s+/g, " ").trim();
  let q = db.from("stays").select("id, guest_name, platform, external_ref, check_in, check_out").eq("organization_id", org.id);
  q = words
    ? q.or(`guest_name.ilike.%${words}%,external_ref.ilike.%${words}%`).gte("check_out", shift(line.date, -365)).lte("check_in", shift(line.date, 365))
    : q.gte("check_out", shift(line.date, -30)).lte("check_in", shift(line.date, 120));
  const { data, error } = await q.limit(200);
  if (error) return { ok: false, error: "Could not search the stays. Try again." };
  const gap = (d: string) => Math.abs(Date.parse(d) - Date.parse(line.date));
  return { ok: true, stays: (data ?? []).sort((a, b) => gap(a.check_in) - gap(b.check_in)).slice(0, 8)
    .map((x) => ({ id: x.id, guest: x.guest_name, platform: x.platform, reference: x.external_ref, checkIn: x.check_in, checkOut: x.check_out })) };
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

/** Sply Accountant over every line still to do with no proposal yet: proposals only, nothing booked. */
export async function askSply(): Promise<Result> {
  const org = await admin();
  if (!org) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  try {
    const r = await runAccountant(db, org.id, { trigger: "app" });
    if (r.error && !r.proposed) return { ok: false, error: r.error };
    const parts = [r.proposed ? `Sply has ${r.proposed} proposal${r.proposed === 1 ? "" : "s"} for you` : "Nothing new for Sply to look at"];
    if (r.error) parts.push(r.error);
    else if (r.left) parts.push(`${r.left} more line${r.left === 1 ? "" : "s"} next time`);
    return done(parts.join(". ") + ".");
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
}

/** OK or Decline on one of Sply's proposals. Its Telegram messages are updated after the reply. */
export async function decide(proposalId: string, decision: "accept" | "reject"): Promise<Result> {
  const org = await admin();
  if (!org || !UUID.test(proposalId)) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  const { data: p } = await db.from("bank_proposals").select("id").eq("id", proposalId).eq("organization_id", org.id).maybeSingle();
  if (!p) return { ok: false, error: "Not allowed." };
  try {
    const d = await decideProposal(db, proposalId, decision);
    after(() => refreshTelegram(org.id, [d.id]).catch((e) => console.error("[accountant] refresh:", e)));
    if (d.status === "failed" || d.status === "stale") return { ok: false, error: d.outcome ?? "Not applied." };
    revalidatePath("/transactions");
    return done();
  } catch (e) {
    return { ok: false, error: e instanceof BankError && e.code === "already_handled" ? "Already decided." : failure(e) };
  }
}

/** OK on every sure proposal still open. */
export async function acceptAllSure(): Promise<Result> {
  const org = await admin();
  if (!org) return { ok: false, error: "Not allowed." };
  const db = await createClient();
  const r = await acceptSure(db, org.id);
  after(() => refreshTelegram(org.id, r.decided.map((d) => d.id)).catch((e) => console.error("[accountant] refresh:", e)));
  revalidatePath("/transactions");
  revalidatePath("/overview");
  return r.failed
    ? { ok: false, error: `${r.applied} done; ${r.failed} could not be applied: see their lines.` }
    : done(`${r.applied} done.`);
}
