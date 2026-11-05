import "server-only";
import { APP_URL } from "@/lib/app-url";
import { editHtml, sendHtml, type Button } from "@/lib/channels/telegram";
import { adminClient } from "@/lib/supabase/admin";
import { escapeHtml, isSure, lineLabel, oneChargePerStatement, proposalLabel, SIGNATURE, telegramText, type ProposalView } from "./render";
import { listProposals } from "./views";

// Sply Accountant in Telegram, for every admin of the organization whose chat is linked: a summary with "OK all sure",
// then one message with OK / Decline per proposal to check, and the questions. The chat assistant gets a note of
// what was asked, so a reply in words reaches it with the line it is about.
// Runs with the server key (no user): every query below is scoped to the organization given.

const MAX_SINGLE = 10;      // messages with buttons per pass; the rest wait in the Bank tab
const MAX_LISTED_SURE = 15; // sure ones listed in the summary
const GAP_MS = 1100;        // Telegram allows about one message a second per chat

export const callbackData = {
  accept: (id: string) => `bp:${id}:y`,
  reject: (id: string) => `bp:${id}:n`,
  /** OK on the first `n` sure ones of the pass, those the summary lists. */
  acceptAll: (runId: string, n: number) => `ba:${runId}:${n}`,
};

const short = (s: string) => (s.length > 110 ? `${s.slice(0, 109)}…` : s);
const pause = () => new Promise((r) => setTimeout(r, GAP_MS));

/**
 * The linked Telegram chats of the organization's admins, for whom it is the organization the chat works in (their
 * first one, as the chat assistant's session). Being made admin of someone else's organization never reaches your chat.
 */
export async function adminChats(orgId: string): Promise<{ linkId: string; chat: string }[]> {
  const db = adminClient();
  const { data: admins } = await db.from("memberships").select("user_id").eq("organization_id", orgId).eq("role", "admin");
  const users = (admins ?? []).map((m) => m.user_id as string);
  if (!users.length) return [];
  const { data: all } = await db.from("memberships").select("user_id, organization_id, created_at").in("user_id", users).order("created_at");
  const first = new Map<string, string>();
  for (const m of all ?? []) if (!first.has(m.user_id)) first.set(m.user_id, m.organization_id);
  const own = users.filter((u) => first.get(u) === orgId);
  if (!own.length) return [];
  const { data: links } = await db.from("channel_links").select("id, external_id")
    .eq("channel", "telegram").in("user_id", own).not("external_id", "is", null);
  return (links ?? []).map((l) => ({ linkId: l.id as string, chat: l.external_id as string }));
}

const buttonsFor = (v: ProposalView): Button[][] => v.status !== "pending" || v.action === "ask" ? []
  : [[{ text: "✅ OK", data: callbackData.accept(v.id) }, { text: "✖ Decline", data: callbackData.reject(v.id) }]];

/**
 * Tells the admins what a pass proposed (or only the chat `only`, if it is one of theirs). A proposal already sent to
 * a chat is not sent to it again; the summary is. Returns how many chats were told.
 */
export async function notifyRun(orgId: string, runId: string, title: string, only?: string): Promise<number> {
  const chats = (await adminChats(orgId)).filter((c) => !only || c.chat === only);
  if (!chats.length) return 0;
  const db = adminClient();
  const views = oneChargePerStatement(await listProposals(db, orgId, { runId, pending: true }));
  if (!views.length) return 0;
  const sure = views.filter(isSure);
  const check = views.filter((v) => !isSure(v) && v.action !== "ask");
  const questions = views.filter((v) => v.action === "ask");
  const singles = [...check, ...questions].slice(0, MAX_SINGLE);
  const waiting = check.length + questions.length - singles.length;

  const summary = [
    `<b>${escapeHtml(SIGNATURE)}</b>`,
    `${escapeHtml(title)}: ${views.length} line${views.length === 1 ? "" : "s"} to do.`,
    [sure.length && `✅ ${sure.length} sure`, check.length && `🔎 ${check.length} to check`, questions.length && `❓ ${questions.length} question${questions.length === 1 ? "" : "s"}`]
      .filter(Boolean).join(" · "),
    ...(sure.length ? ["", "<b>Sure:</b>", ...sure.slice(0, MAX_LISTED_SURE).map((v) => `• ${escapeHtml(lineLabel(v))} → ${escapeHtml(short(proposalLabel(v)))}`)] : []),
    ...(sure.length > MAX_LISTED_SURE ? [`…and ${sure.length - MAX_LISTED_SURE} more in the Bank tab.`] : []),
    ...(waiting > 0 ? ["", `${waiting} more to look at in the Bank tab.`] : []),
  ].join("\n");
  const summaryButtons: Button[][] = [
    ...(sure.length ? [[{ text: sure.length > MAX_LISTED_SURE ? `✅ OK the ${MAX_LISTED_SURE} listed` : `✅ OK all ${sure.length} sure`,
      data: callbackData.acceptAll(runId, Math.min(sure.length, MAX_LISTED_SURE)) }]] : []),
    [{ text: "Open the Bank tab", url: `${APP_URL}/bank` }],
  ];

  for (const { linkId, chat } of chats) {
    try {
      await sendHtml(chat, summary, summaryButtons);
    } catch (e) {
      console.error("[accountant] telegram summary", chat, e);
      continue;
    }
    const sent: ProposalView[] = [];
    for (const v of singles.filter((x) => !x.telegram.some((m) => m.chat === chat))) {
      await pause();
      try {
        const message = await sendHtml(chat, telegramText(v), buttonsFor(v));
        await db.rpc("bank_proposal_telegram", { p_proposal: v.id, p_org: orgId, p_chat: chat, p_message: message });
        sent.push(v);
      } catch (e) {
        console.error("[accountant] telegram", chat, v.id, e);
      }
    }
    await addNotes(linkId, sent.map(note));
  }
  return chats.length;
}

/**
 * Sends one chat what is still waiting for a decision, pass by pass (oldest first): a pass started in the Bank tab
 * is not sent to Telegram, and /bank with nothing new shows these. Returns how many passes were shown.
 */
export async function notifyOpen(orgId: string, chat: string): Promise<number> {
  const open = await listProposals(adminClient(), orgId, { pending: true });
  const runs = [...new Set(open.map((v) => v.runId))];
  let shown = 0;
  for (const runId of runs) shown += await notifyRun(orgId, runId, "Waiting for you", chat) ? 1 : 0;
  return shown;
}

/**
 * What the chat assistant is told about a message Sply sent: data, not instructions. Only Splyce's own facts (the
 * line id, date, amount, what kind of message) are given as such; Sply's wording may quote bank text written by
 * whoever sent the money, so it is passed as untrusted text.
 */
function note(v: ProposalView): Record<string, unknown> {
  return {
    bank_line_id: v.lineId, date: v.line.date, direction: v.line.direction, amount: v.line.amount, currency: v.line.currency,
    sent: v.action === "ask" ? "question" : "proposal with OK / Decline buttons",
    untrusted_text: v.action === "ask" ? v.question : proposalLabel(v),
  };
}

/** Adds notes for the chat assistant, read once on the next turn (see channels/worker). */
export async function addNotes(linkId: string, notes: Record<string, unknown>[]) {
  if (!notes.length) return;
  const { error } = await adminClient().rpc("chat_notes_add", { p_link: linkId, p_notes: notes });
  if (error) console.error("[accountant] notes:", error.message);
}

/** Rewrites the Telegram messages of decided proposals: their outcome, without buttons. Only in admins' own chats. */
export async function refreshTelegram(orgId: string, ids: string[]) {
  if (!ids.length) return;
  const [views, chats] = await Promise.all([listProposals(adminClient(), orgId, { ids }), adminChats(orgId)]);
  const allowed = new Set(chats.map((c) => c.chat));
  for (const v of views) {
    for (const m of v.telegram) {
      if (!allowed.has(m.chat)) continue;
      await editHtml(m.chat, m.message, telegramText(v), buttonsFor(v)).catch((e) => console.error("[accountant] edit", e));
    }
  }
}

/** A title for a pass: the statement's account and month, or "Bank lines". */
export async function runTitle(orgId: string, statementId: string | null): Promise<string> {
  if (!statementId) return "Bank lines";
  const { data } = await adminClient().from("bank_statements")
    .select("period_end, account:bank_accounts (name)").eq("id", statementId).eq("organization_id", orgId).maybeSingle();
  const s = data as unknown as { period_end: string | null; account: { name: string } | null } | null;
  if (!s) return "New statement";
  const month = s.period_end ? new Date(`${s.period_end}T00:00:00Z`).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" }) : null;
  return [s.account?.name ?? "Statement", month].filter(Boolean).join(", ");
}
