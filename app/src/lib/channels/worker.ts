import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { respond } from "@/lib/agent/run";
import { readFileInput } from "@/lib/mcp/files";
import { sessionFor, ToolError, type Session } from "@/lib/mcp/session";
import { adminClient } from "@/lib/supabase/admin";
import { accessTokenFor, unlink, type Link } from "./links";
import { APP_URL } from "./oauth";
import { downloadFile, sendMessage, sendTyping } from "./telegram";
import { transcribe } from "./transcribe";

type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;

/** One incoming chat message, as queued by the webhook. */
export interface Incoming {
  text?: string;
  file?: { id: string; kind: "photo" | "document"; mime?: string; name?: string };
  voice?: { id: string; mime?: string };
}
type Attachments = Record<string, { path: string; mimeType: string; used?: boolean }>;

const FRESH_AFTER_MS = 6 * 3600_000; // a new conversation after 6 quiet hours
const MAX_MESSAGES = 60;             // or once it gets long
const MAX_INLINE_PDF = 4 * 1024 * 1024;

/** Answers everything queued for this chat, one turn at a time; only one worker per chat at once. */
export async function processChat(link: Link, chatId: string) {
  const db = adminClient();
  const claim = async () => (await db.rpc("chat_claim", { p_link: link.id })).data === true;
  if (!(await claim())) return; // another worker is answering; it will see this message
  await new Promise((r) => setTimeout(r, 1500)); // let an album or a caption arrive with its photo
  for (;;) {
    try {
      const { data: items } = await db.rpc("chat_take", { p_link: link.id });
      if (Array.isArray(items) && items.length) await answer(link, chatId, items as Incoming[]);
    } catch (e) {
      console.error("[chat] answer:", e);
      await sendMessage(chatId, "Sorry, I couldn't answer just now. Try again in a minute.").catch(() => {});
    }
    const { data: more } = await db.rpc("chat_release", { p_link: link.id });
    if (!more || !(await claim())) return;
  }
}

async function answer(link: Link, chatId: string, items: Incoming[]) {
  await sendTyping(chatId);
  const token = await accessTokenFor(link.id);
  if (!token) {
    await unlink("telegram", chatId);
    await sendMessage(chatId, `Your ONBA Books connection has expired. Connect again: ${APP_URL}/connect/telegram`);
    return;
  }
  let session: Session;
  try { session = await sessionFor(token, link.user_id); } catch (e) {
    await sendMessage(chatId, e instanceof ToolError ? e.message : "Could not open ONBA Books. Try again in a minute.");
    return;
  }

  const db = adminClient();
  const { data: convo } = await db.from("chat_conversations").select("messages, attachments, updated_at").eq("link_id", link.id).single();
  const stale = !convo || Date.parse(convo.updated_at) < Date.now() - FRESH_AFTER_MS || (convo.messages as unknown[]).length > MAX_MESSAGES;
  const history = (stale ? [] : convo.messages) as MessageParam[];
  const attachments = (stale ? {} : convo.attachments) as Attachments;

  const content: ContentBlockParam[] = [];
  for (const item of items) {
    if (item.file) content.push(...(await intake(session, item.file, attachments)));
    if (item.voice) content.push(await listen(session, item.voice));
    if (item.text) content.push({ type: "text", text: item.text });
  }
  if (!content.length) return;

  session.attachments = new Map(Object.entries(attachments).map(([k, v]) => [k, { path: v.path, mimeType: v.mimeType }]));
  session.usedAttachments = new Set(Object.entries(attachments).filter(([, v]) => v.used).map(([k]) => k));
  const typing = setInterval(() => void sendTyping(chatId), 4500);
  try {
    const turn = await respond(session, history, content);
    for (const id of session.usedAttachments) if (attachments[id]) attachments[id].used = true;
    await db.from("chat_conversations").update({
      messages: turn.history, attachments, updated_at: new Date().toISOString(),
    }).eq("link_id", link.id);
    await sendMessage(chatId, turn.reply);
  } finally {
    clearInterval(typing);
  }
}

/** Stores a file the user sent in the organization's evidence folder and shows it to the model as att_N. */
async function intake(s: Session, f: NonNullable<Incoming["file"]>, attachments: Attachments): Promise<ContentBlockParam[]> {
  const id = `att_${Object.keys(attachments).length + 1}`;
  let file: Awaited<ReturnType<typeof readFileInput>>;
  try {
    const bytes = await downloadFile(f.id);
    file = await readFileInput({ file_base64: Buffer.from(bytes).toString("base64"), mime_type: f.mime });
  } catch (e) {
    return [{ type: "text", text: `[A file was sent but could not be used: ${e instanceof ToolError ? e.message : "download failed"}]` }];
  }
  if (s.role === "owner_viewer") return [{ type: "text", text: "[A file was sent, but this account can only read; it was not stored.]" }];
  const path = `${s.org.id}/${crypto.randomUUID()}.${file.extension}`;
  const up = await s.db.storage.from("evidence").upload(path, file.bytes, { contentType: file.mimeType });
  if (up.error) return [{ type: "text", text: "[A file was sent but could not be stored.]" }];
  attachments[id] = { path, mimeType: file.mimeType };

  const label: ContentBlockParam = { type: "text", text: `[${id}: ${file.mimeType === "application/pdf" ? "PDF" : "photo"}${f.name ? ` "${f.name}"` : ""}]` };
  const data = Buffer.from(file.bytes).toString("base64");
  if (file.mimeType === "application/pdf") {
    return file.bytes.length <= MAX_INLINE_PDF
      ? [label, { type: "document", source: { type: "base64", media_type: "application/pdf", data } }]
      : [label, { type: "text", text: "(PDF too large to show; it can still be submitted.)" }];
  }
  return [label, { type: "image", source: { type: "base64", media_type: file.mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data } }];
}

/** A voice note becomes its transcription; the model is told it is one, so it restates what it understood. */
async function listen(s: Session, v: NonNullable<Incoming["voice"]>): Promise<ContentBlockParam> {
  try {
    const text = await transcribe(s, await downloadFile(v.id), v.mime);
    return { type: "text", text: text ? `[Voice note, transcribed: "${text}"]` : "[Voice note: nothing could be heard.]" };
  } catch (e) {
    console.error("[chat] transcribe:", e);
    return { type: "text", text: "[A voice note was sent but could not be transcribed. Ask the user to type it.]" };
  }
}
