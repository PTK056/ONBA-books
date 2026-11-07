import "server-only";
import { APP_URL } from "@/lib/app-url";
import { sendHtml, type Button } from "@/lib/channels/telegram";
import { today, type Session } from "@/lib/mcp/session";
import { moduleOn } from "@/lib/settings";
import { closeData, closingText, coverage, monthEnd, monthName, previousMonth, weeklyText, type Scheduled } from "./closing";
import { addNotes, notifyOpen } from "./notify";
import { runAccountant } from "./run";
import { listProposals } from "./views";

// Sply Accountant on its own, from the morning cron (api/cron/brief): every Monday a review of what is left, on the
// 10th the closing of last month, on the 15th a reminder if it is still open. Acts as the admin whose chat this is
// (their Splyce session): it proposes and asks, it never books or closes anything by itself; closing is a button.

const links = {
  bank: `${APP_URL}/bank`, review: `${APP_URL}/review`, missing: `${APP_URL}/transactions?receipt=missing`,
};

type Expense = { id: string; date: string; amount: number; currency: string; description: string | null };

async function missingReceipts(s: Session, from: string, to: string) {
  const { data, count } = await s.db.from("expenses_missing_evidence").select("id, date, amount, currency, description", { count: "exact" })
    .eq("organization_id", s.org.id).gte("date", from).lte("date", to).order("date", { ascending: false }).limit(10);
  const latest = ((data ?? []) as Expense[]).map((e) => ({ ...e, amount: Number(e.amount) }));
  return { count: count ?? latest.length, latest };
}

async function receiptsToReview(s: Session) {
  const { count } = await s.db.from("receipt_items").select("id", { count: "exact", head: true })
    .eq("organization_id", s.org.id).eq("status", "pending").not("read_at", "is", null);
  return count ?? 0;
}

async function linesToDo(s: Session, from?: string, to?: string) {
  let q = s.db.from("bank_lines").select("id", { count: "exact", head: true }).eq("organization_id", s.org.id).eq("status", "unmatched")
    .is("set_aside_at", null); // set aside by the owner: not to do
  if (from && to) q = q.gte("date", from).lte("date", to);
  const { count } = await q;
  return count ?? 0;
}

/** Data, never instructions: one short line, no line breaks or brackets to close the note it sits in. */
const untrusted = (s: string | null) => (s ? s.replace(/[\r\n[\]{}]+/g, " ").trim().slice(0, 120) : null);

/** The chat assistant learns which expenses were asked for, so a photo sent in reply is attached to the right one. */
async function askForReceipts(linkId: string, latest: Expense[], on: string) {
  await addNotes(linkId, latest.map((e) => ({
    transaction_id: e.id, date: e.date, amount: e.amount, currency: e.currency, asked_on: on,
    sent: "receipt requested: the user may send its photo or PDF next (attach it with attach_evidence)",
    untrusted_text: untrusted(e.description),
  })));
}

/**
 * Runs what today calls for in one admin's chat. Returns whether a message was sent. `pass`: whether to go through
 * the lines with Claude first, and within how long (the cron gives one pass per organization, while it has time).
 */
export async function runScheduled(
  s: Session, link: { id: string; chat: string }, what: Scheduled, pass: { timeoutMs: number } | null,
): Promise<boolean> {
  if (s.role !== "admin") return false;
  // Bank reconciliation is an optional module: off, Sply Accountant does not write (the brief covers receipts and the close).
  if (!(await moduleOn(s.db, s.org.id, "bank"))) return false;
  const day = today(s);
  const closing = what !== "weekly";
  const month = previousMonth(day);
  const end = monthEnd(month);

  if (closing) {
    // Nothing to do when last month is already closed everywhere.
    const places = [...s.villas, ...(s.company ? [s.company] : [])];
    const { data: closes } = await s.db.from("month_closes").select("villa_id, status").eq("organization_id", s.org.id).eq("month", month);
    const closed = new Set((closes ?? []).filter((c) => c.status === "closed").map((c) => c.villa_id as string));
    if (places.every((p) => closed.has(p.id))) return false;
  }

  // A pass first, over the lines left: a receipt or an entry added since may explain some. Proposals only.
  const run = pass
    ? await runAccountant(s.db, s.org.id, { trigger: closing ? "monthly" : "weekly", timeoutMs: pass.timeoutMs })
      .catch((e) => { console.error("[accountant] scheduled pass", s.org.id, e); return null; })
    : null;
  if (run?.error) console.error("[accountant] scheduled pass:", run.error);

  let sent = false;
  if (!closing) {
    const pending = await listProposals(s.db, s.org.id, { pending: true });
    const [toDo, receipts, missing] = await Promise.all([
      linesToDo(s), receiptsToReview(s), missingReceipts(s, month, day),
    ]);
    const html = weeklyText({
      linesToDo: toDo, withProposal: pending.length, questions: pending.filter((p) => p.action === "ask").length,
      receiptsToReview: receipts, missingReceipts: missing,
    }, links);
    if (html) {
      await sendHtml(link.chat, html);
      sent = true;
      await askForReceipts(link.id, missing.latest.slice(0, 8), day);
    }
  } else {
    const places = [...s.villas, ...(s.company ? [s.company] : [])];
    const [{ data: accounts }, { data: statements }, { data: closes }, toDo, receipts, missing] = await Promise.all([
      s.db.from("bank_accounts").select("id, name, last4").eq("organization_id", s.org.id).is("archived_at", null).order("name"),
      s.db.from("bank_statements").select("account_id, period_start, period_end").eq("organization_id", s.org.id)
        .lte("period_start", end).gte("period_end", month),
      s.db.from("month_closes").select("villa_id, status").eq("organization_id", s.org.id).eq("month", month),
      linesToDo(s, month, end), receiptsToReview(s), missingReceipts(s, month, end),
    ]);
    const closed = new Set((closes ?? []).filter((c) => c.status === "closed").map((c) => c.villa_id as string));
    const report = closingText({
      month,
      accounts: (accounts ?? []).map((a) => ({
        name: a.last4 ? `${a.name} ••••${a.last4}` : a.name as string,
        coverage: coverage((statements ?? []).filter((x) => x.account_id === a.id).map((x) => ({ start: x.period_start, end: x.period_end })), month),
      })),
      linesToDo: toDo, receiptsToReview: receipts, missingReceipts: missing,
      places: places.map((p) => ({ name: p.name, closed: closed.has(p.id) })),
    }, what === "closing_reminder", links);
    if (report) {
      const label = `🔒 Close ${monthName(month).split(" ")[0]}${report.ready ? "" : " anyway"}`;
      const buttons: Button[][] = [[{ text: label, data: closeData(s.org.id, month) }], [{ text: "Open Overview", url: `${APP_URL}/overview?month=${month.slice(0, 7)}` }]];
      await sendHtml(link.chat, report.html, buttons);
      sent = true;
      await askForReceipts(link.id, missing.latest.slice(0, 5), day);
    }
  }
  // The proposals still waiting, with their buttons (those already sent to this chat are not sent again).
  if (sent) await notifyOpen(s.org.id, link.chat).catch((e) => console.error("[accountant] scheduled proposals", e));
  return sent;
}

/**
 * Closes a month for every place of the organization not closed yet, as the admin who pressed the button (the
 * database lets admins only). Returns the names closed now.
 */
export async function closeMonth(s: Session, month: string): Promise<string[]> {
  const places = [...s.villas, ...(s.company ? [s.company] : [])];
  const { data: closes, error } = await s.db.from("month_closes").select("villa_id, status").eq("organization_id", s.org.id).eq("month", month);
  if (error) throw new Error(`month_closes: ${error.message}`);
  const closed = new Set((closes ?? []).filter((c) => c.status === "closed").map((c) => c.villa_id as string));
  const toClose = places.filter((p) => !closed.has(p.id));
  if (!toClose.length) return [];
  const at = new Date().toISOString();
  const { error: e } = await s.db.from("month_closes").upsert(
    toClose.map((p) => ({ organization_id: s.org.id, villa_id: p.id, month, status: "closed", closed_by: s.userId, closed_at: at })),
    { onConflict: "villa_id,month" },
  );
  if (e) throw new Error(`month_closes: ${e.message}`);
  return toClose.map((p) => p.name);
}
