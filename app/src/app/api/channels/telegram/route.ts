import { after, NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { findLink, redeemCode, unlink } from "@/lib/channels/links";
import { APP_URL } from "@/lib/channels/oauth";
import { sendMessage, type TgMessage } from "@/lib/channels/telegram";
import { transcriptionEnabled } from "@/lib/channels/transcribe";
import { processChat, type Incoming } from "@/lib/channels/worker";
import { adminClient } from "@/lib/supabase/admin";

// Telegram webhook. Answers 200 at once and does the work after the response,
// so Telegram never retries a message while Claude is still thinking.
export const maxDuration = 300;

const CONNECT = `${APP_URL}/connect/telegram`;
const MAX_VOICE_SECONDS = 180;
const HELP = "Send me receipts (photo or PDF), voice notes, expenses (\"350k petrol Kadek yesterday\"), booking screenshots or reminders, "
  + "and ask what's left to do.\n/new starts a fresh conversation · /stop disconnects this chat.";

export async function POST(request: NextRequest) {
  if (!validSecret(request.headers.get("x-telegram-bot-api-secret-token"))) return new NextResponse(null, { status: 401 });
  const update = await request.json().catch(() => null);
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
        ? `Connected to ONBA Books${linked.email ? ` as ${linked.email}` : ""}. ✅\n\n${HELP}`
        : `That link has expired or was already used. Get a new one: ${CONNECT}`);
    }
  }

  const link = await findLink("telegram", chatId);
  if (!link) return sendMessage(chatId, `Hi! To use ONBA Books here, connect your account first: ${CONNECT}`);

  if (text === "/start" || text === "/help") return sendMessage(chatId, HELP);
  if (text === "/stop") {
    await unlink("telegram", chatId);
    return sendMessage(chatId, "Disconnected. ONBA Books no longer has access from this chat.");
  }
  if (text === "/new") {
    await adminClient().from("chat_conversations").update({ messages: [], attachments: {} }).eq("link_id", link.id);
    return sendMessage(chatId, "Fresh start. What can I do?");
  }
  const item: Incoming = { text: msg.text ?? msg.caption };
  if (msg.voice) {
    if (!transcriptionEnabled()) return sendMessage(chatId, "I can't listen to voice notes yet. Type it, or send a photo.");
    if ((msg.voice.duration ?? 0) > MAX_VOICE_SECONDS) return sendMessage(chatId, "That voice note is too long. Keep it under 3 minutes.");
    item.voice = { id: msg.voice.file_id, mime: msg.voice.mime_type };
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

function validSecret(given: string | null) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!expected || !given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
