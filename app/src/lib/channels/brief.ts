import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { toolDefs } from "@/lib/mcp/tools";
import type { Session } from "@/lib/mcp/session";

// Morning brief: what is left to do, from get_todo, trimmed to what needs the user soon.
// Returns null when nothing does: then no message is sent.

const SOON_DAYS = 3;
const CLOSE_REMINDER_UNTIL_DAY = 10; // remind to close last month during the first days only

interface Todo {
  today: string;
  tasks: { title: string; kind: string; due_date: string | null; overdue: boolean; amount: number | null; currency: string | null; villa: string | null }[];
  receipts_to_review: number;
  expenses_missing_receipt: { count: number; latest: { date: string; amount: number; currency: string; description: string | null }[] };
  month_to_close: { month: string; villas: string[] } | null;
  review: string;
}

const getTodo = toolDefs("chat").find((t) => t.name === "get_todo")!;

/** What deserves a message this morning, or null. */
export async function briefItems(s: Session) {
  const todo = (await getTodo.handler(s, {} as never)) as Todo;
  const soon = new Date(Date.parse(`${todo.today}T00:00:00Z`) + SOON_DAYS * 86_400_000).toISOString().slice(0, 10);
  const items = {
    today: todo.today,
    tasks_due: todo.tasks.filter((t) => t.due_date && t.due_date <= soon),
    receipts_to_review: todo.receipts_to_review,
    expenses_missing_receipt: todo.expenses_missing_receipt,
    month_to_close: Number(todo.today.slice(8, 10)) <= CLOSE_REMINDER_UNTIL_DAY ? todo.month_to_close : null,
    review_link: todo.review,
  };
  const empty = !items.tasks_due.length && !items.receipts_to_review && !items.expenses_missing_receipt.count && !items.month_to_close;
  return empty ? null : items;
}

const client = new Anthropic();

/** A short message for a phone, in the user's language (guessed from their recent messages). */
export async function writeBrief(items: object, recentUserText: string[]): Promise<string> {
  const r = await client.messages.create({
    model: process.env.AGENT_MODEL ?? "claude-opus-5-5",
    max_tokens: 2000,
    output_config: { effort: "low" },
    system:
      "You write the Splyce morning brief for someone who runs short-term-rental villas, sent in a chat on their phone. "
      + "From the JSON, write a short message: a one-line greeting, then only what needs them (overdue first), a few short bullets, "
      + "amounts with thousand separators and currency, the review link if receipts wait. End with one short offer to help. "
      + "No headings, no tables, **bold** at most once. Write in the language of the user's recent messages; English if there are none.",
    messages: [{
      role: "user",
      content: `Recent messages from the user:\n${recentUserText.map((t) => `- ${t}`).join("\n") || "(none)"}\n\nTo-do JSON:\n${JSON.stringify(items)}`,
    }],
  });
  return r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}

/** The user's own words from a stored conversation (no tool results, no file labels), most recent last. */
export function recentUserText(messages: Anthropic.Beta.Messages.BetaMessageParam[], n = 4): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    for (const b of blocks) {
      if (b.type !== "text") continue;
      const voice = b.text.match(/^\[Voice note, transcribed: "([\s\S]*)"\]$/)?.[1];
      if (voice) out.push(voice.slice(0, 200));
      else if (!b.text.startsWith("[") && !b.text.startsWith("(Today is")) out.push(b.text.slice(0, 200));
    }
  }
  return out.slice(-n);
}
