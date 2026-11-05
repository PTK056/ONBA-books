import { after, NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { findLink, redeemCode, unlink } from "@/lib/channels/links";
import { APP_URL } from "@/lib/channels/oauth";
import { answerCallback, editHtml, sendMessage, type TgCallback, type TgMessage } from "@/lib/channels/telegram";
import { transcriptionEnabled } from "@/lib/channels/transcribe";
import { processChat, type Incoming } from "@/lib/channels/worker";
import { adminClient } from "@/lib/supabase/admin";
import { accessTokenFor } from "@/lib/channels/links";
import { acceptSure, decideProposal } from "@/lib/bank/accountant/apply";
import { monthName, previousMonth } from "@/lib/bank/accountant/closing";
import { addNotes, notifyOpen, notifyRun, refreshTelegram, runTitle } from "@/lib/bank/accountant/notify";
import { closeMonth } from "@/lib/bank/accountant/schedule";
import { runAccountant } from "@/lib/bank/accountant/run";
import { escapeHtml, SIGNATURE } from "@/lib/bank/accountant/render";
import { BankError } from "@/lib/bank/errors";
import { clientFor, sessionFor, today } from "@/lib/mcp/session";

// Telegram webhook. Answers 200 at once and does the work after the response,
// so Telegram never retries a message while Claude is still thinking.
export const maxDuration = 300;

const CONNECT = `${APP_URL}/connect/telegram`;
const MAX_VOICE_SECONDS = 180;
const HELP = "Send me receipts (photo or PDF), voice notes, expenses (\"350k petrol Kadek yesterday\"), booking screenshots or reminders, "
  + "and ask what's left to do. Each morning I send what needs you, if anything.\n"
  + "/bank: Sply Accountant goes through the bank lines left to do · /new starts a fresh conversation · /brief off stops the morning brief · /stop disconnects this chat.";

export async function POST(request: NextRequest) {
  if (!validSecret(request.headers.get("x-telegram-bot-api-secret-token"))) return new NextResponse(null, { status: 401 });
  const update = await request.json().catch(() => null);
  const pressed = update?.callback_query as TgCallback | undefined;
  if (pressed) {
    after(() => handleButton(pressed).catch((e) => console.error("[telegram] button", e)));
    return NextResponse.json({ ok: true });
  }
  const msg = update?.message as TgMessage | undefined;
  if (!msg) return NextResponse.json({ ok: true }); // edits, reactions…: ignored
  after(() => handle(msg).catch((e) => console.error("[telegram]", e)));
  return NextResponse.json({ ok: true });
}

async function handle(msg: TgMessage) {
  const chatId = String(msg.chat.id);
  if (msg.chat.type !== "private") return sendMessage(chatId, "I only work in a private chat.");
  const text = msg.text?.trim() ?? "";

  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1];
    if (code) {
      const linked = await redeemCode("telegram", code, chatId, msg.from?.username ?? msg.from?.first_name ?? null);
      return sendMessage(chatId, linked
        ? `Connected to Splyce${linked.email ? ` as ${linked.email}` : ""}. ✅\n\n${HELP}`
        : `That link has expired or was already used. Get a new one: ${CONNECT}`);
    }
  }

  const link = await findLink("telegram", chatId);
  if (!link) return sendMessage(chatId, `Hi! To use Splyce here, connect your account first: ${CONNECT}`);

  if (text === "/start" || text === "/help") return sendMessage(chatId, HELP);
  if (text === "/stop") {
    await unlink("telegram", chatId);
    return sendMessage(chatId, "Disconnected. Splyce no longer has access from this chat.");
  }
  if (text === "/brief off" || text === "/brief on") {
    const on = text.endsWith("on");
    await adminClient().from("channel_links").update({ brief_enabled: on }).eq("id", link.id);
    return sendMessage(chatId, on ? "Morning brief on: each morning, what's left to do (nothing if nothing is)." : "Morning brief off. /brief on to turn it back on.");
  }
  if (text === "/bank") {
    return bankPass(link, chatId).catch(async (e) => {
      console.error("[telegram] /bank", e);
      await sendMessage(chatId, "🧾 Sply Accountant could not go through the bank lines just now. Try again in a few minutes.");
    });
  }
  if (text === "/new") {
    await adminClient().from("chat_conversations").update({ messages: [], attachments: {} }).eq("link_id", link.id);
    return sendMessage(chatId, "Fresh start. What can I do?");
  }
  const item: Incoming = { text: msg.text ?? msg.caption };
  if (msg.voice) {
    if (!transcriptionEnabled()) return sendMessage(chatId, "I can't listen to voice notes yet. Type it, or send a photo.");
    if ((msg.voice.duration ?? 0) > MAX_VOICE_SECONDS) return sendMessage(chatId, "That voice note is too long. Keep it under 3 minutes.");
    item.voice = { id: msg.voice.file_id, mime: msg.voice.mime_type, seconds: msg.voice.duration };
  }
  if (msg.photo?.length) {
    const largest = msg.photo.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
    item.file = { id: largest.file_id, kind: "photo", mime: "image/jpeg" };
  } else if (msg.document) {
    item.file = { id: msg.document.file_id, kind: "document", mime: msg.document.mime_type, name: msg.document.file_name };
  }
  if (!item.text && !item.file && !item.voice) return sendMessage(chatId, "Send text, a voice note, a photo or a PDF.");

  await adminClient().rpc("chat_enqueue", { p_link: link.id, p_item: item });
  await processChat(link, chatId);
}

/** /bank: Sply Accountant proposes what each bank line left to do is; the proposals arrive here with their buttons. */
async function bankPass(link: { id: string; user_id: string }, chatId: string) {
  const token = await accessTokenFor(link.id);
  if (!token) return sendMessage(chatId, `Your Splyce connection has expired. Connect again: ${CONNECT}`);
  const session = await sessionFor(token, link.user_id);
  if (session.role !== "admin") return sendMessage(chatId, "Only admins of the organization can see the bank lines.");
  await sendMessage(chatId, "🧾 Sply Accountant is going through your bank lines…");
  const run = await runAccountant(session.db, session.org.id, { trigger: "chat" });
  if (run.runId && run.proposed) {
    await notifyRun(session.org.id, run.runId, await runTitle(session.org.id, null));
    if (run.left) await sendMessage(chatId, `🧾 ${run.left} more line${run.left === 1 ? "" : "s"} next time: send /bank again once these are decided.`);
    return;
  }
  if (run.error) await sendMessage(chatId, `🧾 ${run.error}`);
  // Nothing new: what earlier passes proposed and is still undecided (a pass from the Bank tab is not sent here).
  if (await notifyOpen(session.org.id, chatId)) return;
  if (!run.error) await sendMessage(chatId, "🧾 Nothing to do: every bank line is handled.");
}

/**
 * A button under a Sply Accountant message: OK / Decline on one proposal (bp:<id>:y|n), or OK all sure (ba:<run>).
 * Acts as the user this chat is linked to, so the database checks they are an admin of the proposal's organization.
 */
async function handleButton(cb: TgCallback) {
  const chat = cb.message?.chat;
  if (!chat || chat.type !== "private" || !cb.data) return answerCallback(cb.id);
  const link = await findLink("telegram", String(chat.id));
  if (!link) return answerCallback(cb.id, "Connect this chat to Splyce first.");
  const token = await accessTokenFor(link.id);
  if (!token) return answerCallback(cb.id, "Your Splyce connection has expired: connect again.");
  const db = clientFor(token);

  const one = /^bp:([0-9a-f-]{36}):([yn])$/i.exec(cb.data);
  const all = /^ba:([0-9a-f-]{36}):(\d{1,3})$/i.exec(cb.data);
  const close = /^mc:([0-9a-f-]{36}):(\d{4})-(0[1-9]|1[0-2])$/i.exec(cb.data);
  try {
    if (close) {
      // Closing last month (Sply Accountant's closing message): admins only, and only a month that is over.
      const session = await sessionFor(token, link.user_id);
      if (session.org.id !== close[1].toLowerCase()) return answerCallback(cb.id, "This message is about another organization.");
      if (session.role !== "admin") return answerCallback(cb.id, "Only an admin can close a month.");
      const month = `${close[2]}-${close[3]}-01`;
      // Only last month: an older message's button is out of date (a month reopened since stays open).
      if (month !== previousMonth(today(session))) return answerCallback(cb.id, "This message is out of date: close the month in Overview.");
      const names = await closeMonth(session, month).catch((e) => {
        console.error("[accountant] close month", e);
        return null;
      });
      if (!names) return answerCallback(cb.id, "Could not close it. Try again, or close it in Overview.");
      await answerCallback(cb.id, names.length ? `${monthName(month)} closed` : "Already closed.");
      if (cb.message) {
        await editHtml(String(chat.id), cb.message.message_id,
          `<b>${escapeHtml(SIGNATURE)}</b>\n🔒 ${escapeHtml(monthName(month))} closed${names.length ? `: ${escapeHtml(names.join(", "))}` : " already"}. `
            + "Its entries can no longer change; reopen it in Overview if needed.",
          [[{ text: "Open Overview", url: `${APP_URL}/overview?month=${month.slice(0, 7)}` }]]);
      }
      return;
    }
    if (one) {
      const { data: p } = await db.from("bank_proposals").select("organization_id, line_id").eq("id", one[1]).maybeSingle();
      if (!p) return answerCallback(cb.id, "This proposal is not yours to decide.");
      const d = await decideProposal(db, one[1], one[2] === "y" ? "accept" : "reject");
      await answerCallback(cb.id, d.status === "applied" ? "Done ✅" : d.status === "rejected" ? "Declined" : d.outcome ?? "Not applied");
      await refreshTelegram(p.organization_id, [d.id]);
      if (d.status === "rejected") {
        await sendMessage(String(chat.id), "Noted. Tell me what it is (e.g. \"Pool & garden, Casa ONBA\"), or handle it in the Bank tab.");
        await addNotes(link.id, [{ bank_line_id: p.line_id, sent: "proposal declined by the user; they may now say what the line is" }]);
      }
      return;
    }
    if (all) {
      const { data: run } = await db.from("bank_accountant_runs").select("organization_id").eq("id", all[1]).maybeSingle();
      if (!run) return answerCallback(cb.id, "This is not yours to decide.");
      const r = await acceptSure(db, run.organization_id, all[1], Number(all[2]));
      await answerCallback(cb.id, `${r.applied} done${r.failed ? `, ${r.failed} not applied` : ""}`);
      await refreshTelegram(run.organization_id, r.decided.map((d) => d.id));
      if (cb.message) {
        await editHtml(String(chat.id), cb.message.message_id,
          `<b>${escapeHtml(SIGNATURE)}</b>\n✅ ${r.applied} sure one${r.applied === 1 ? "" : "s"} done${r.failed ? ` · ⚠️ ${r.failed} not applied (see the Bank tab)` : ""}.`,
          [[{ text: "Open the Bank tab", url: `${APP_URL}/bank` }]]);
      }
      return;
    }
    return answerCallback(cb.id);
  } catch (e) {
    if (e instanceof BankError) return answerCallback(cb.id, e.code === "already_handled" ? "Already decided." : e.message);
    throw e;
  }
}

function validSecret(given: string | null) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!expected || !given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
