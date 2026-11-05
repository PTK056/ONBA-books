import "server-only";

// Telegram Bot API: the few calls the agent needs.
const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function call<T = unknown>(method: string, body: object, retry = true): Promise<T> {
  const res = await fetch(`${API()}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  // Too many messages: Telegram says how long to wait; wait once (up to 10 s) and try again.
  const wait = Number(json.parameters?.retry_after);
  if (!json.ok && res.status === 429 && retry && wait > 0 && wait <= 10) {
    await new Promise((r) => setTimeout(r, wait * 1000));
    return call<T>(method, body, false);
  }
  if (!json.ok) throw new Error(`telegram ${method}: ${res.status} ${json.description ?? ""}`);
  return json.result as T;
}

/** Sends a reply, formatted as Telegram HTML; falls back to plain text if Telegram rejects the markup. */
export async function sendMessage(chatId: string, text: string) {
  for (const part of chunks(text, 3800)) {
    try {
      await call("sendMessage", { chat_id: chatId, text: toHtml(part), parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    } catch {
      await call("sendMessage", { chat_id: chatId, text: part, link_preview_options: { is_disabled: true } });
    }
  }
}

/** A button under a message: it either sends `data` back to the webhook (callback_query) or opens `url`. */
export type Button = { text: string; data: string } | { text: string; url: string };

const keyboard = (buttons?: Button[][]) => buttons?.length
  ? { inline_keyboard: buttons.map((row) => row.map((b) => ("data" in b ? { text: b.text, callback_data: b.data } : { text: b.text, url: b.url }))) }
  : { inline_keyboard: [] };

/** Sends HTML we wrote ourselves (already escaped, and short: fields are cut before escaping), with buttons; returns the message id. */
export async function sendHtml(chatId: string, html: string, buttons?: Button[][]): Promise<number> {
  const m = await call<{ message_id: number }>("sendMessage", {
    chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true },
    ...(buttons?.length ? { reply_markup: keyboard(buttons) } : {}),
  });
  return m.message_id;
}

/** Rewrites a message we sent (e.g. once its buttons were used); no buttons given removes them. */
export async function editHtml(chatId: string, messageId: number, html: string, buttons?: Button[][]) {
  await call("editMessageText", {
    chat_id: chatId, message_id: messageId, text: html, parse_mode: "HTML",
    link_preview_options: { is_disabled: true }, reply_markup: keyboard(buttons),
  }).catch((e) => {
    if (!String(e).includes("message is not modified")) throw e;
  });
}

/** Ends the spinner on a pressed button, with an optional short notice. */
export const answerCallback = (id: string, text?: string) =>
  call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text: text.slice(0, 190) } : {}) }).catch(() => {});

export const sendTyping = (chatId: string) => call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});

/** Downloads a file the user sent (photos up to 20 MB through the Bot API). */
export async function downloadFile(fileId: string): Promise<Uint8Array> {
  const f = await call<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!f.file_path) throw new Error("telegram getFile: no path");
  const res = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${f.file_path}`);
  if (!res.ok) throw new Error(`telegram download: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** The model writes light Markdown; Telegram HTML needs escaping and a few tags. */
export function toHtml(md: string): string {
  return md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
}

function chunks(text: string, size: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    const cut = rest.lastIndexOf("\n", size) > size / 2 ? rest.lastIndexOf("\n", size) : size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  return [...out, rest];
}

// Incoming update, as much of it as we use.
export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
  caption?: string;
  photo?: { file_id: string; file_size?: number; width: number; height: number }[];
  document?: { file_id: string; mime_type?: string; file_name?: string; file_size?: number };
  voice?: { file_id: string; duration?: number; mime_type?: string };
  media_group_id?: string;
}

/** A pressed button, as much of it as we use. */
export interface TgCallback {
  id: string;
  from: { id: number };
  message?: { message_id: number; chat: { id: number; type: string } };
  data?: string;
}
