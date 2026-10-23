import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { runTool, toolDefs } from "@/lib/mcp/tools";
import { today, type Session } from "@/lib/mcp/session";

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

const MODEL = process.env.AGENT_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.AGENT_EFFORT ?? "medium") as "low" | "medium" | "high";
const MAX_STEPS = 10;

// Frozen text: it sits in the cached prefix with the tools, so nothing in it may vary per request.
const SYSTEM = `You are the ONBA Books assistant, in a chat with someone who runs short-term-rental villas (an owner or a manager).
You keep their books in ONBA Books through the tools; you act with their own access.

How to work:
- At the start of a conversation, call get_context: it gives the villas, categories, currency and today's date. Use only those villa and category names.
- A photo or PDF of a receipt, invoice or transfer slip: call submit_receipt with its attachment_id. It goes to the review queue; say so and share the review link.
- A booking screenshot or confirmation: read the details from it and call record_stay; ask for anything missing (dates, amount, villa).
- An expense or income stated in words ("350k petrol Kadek yesterday"): record_transaction. 350k means 350000; resolve relative dates from today.
- Reminders about the villas (bills to pay, receipts to bring, things to finish): add_task. "What's left?" or a morning check: get_todo.
- Never guess a villa, an amount or a date: ask one short question. When a file is unclear, say what you can read and ask.
- After every write, repeat exactly what was saved (date, villa, category, amount) in one or two lines. Offer to undo a mistaken entry (delete_transaction).

Style: reply in the user's language. Short messages for a phone: no headings, no tables, at most a few short lines or bullets. Use **bold** sparingly. Amounts with thousand separators and the currency (e.g. 350,000 IDR).`;

const client = new Anthropic();

const DEFS = toolDefs("chat");
const TOOLS: Anthropic.Beta.Messages.BetaTool[] = DEFS.map((t) => {
  const schema = z.toJSONSchema(t.inputSchema, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return { name: t.name, description: t.description, input_schema: schema as Anthropic.Beta.Messages.BetaTool.InputSchema };
});

export interface Turn { reply: string; history: MessageParam[] }

/** Answers one user turn: the model calls tools until it has a reply. The history is only ever appended to. */
export async function respond(session: Session, history: MessageParam[], user: ContentBlockParam[]): Promise<Turn> {
  const messages: MessageParam[] = [
    ...history,
    { role: "user", content: [...user, { type: "text", text: `(Today is ${today(session)}.)` }] },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      tools: TOOLS,
      messages,
      output_config: { effort: EFFORT },
      cache_control: { type: "ephemeral" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    messages.push({ role: "assistant", content: r.content as ContentBlockParam[] });

    if (r.stop_reason === "pause_turn") continue;
    if (r.stop_reason === "tool_use") {
      const results: ToolResult[] = [];
      for (const block of r.content) {
        if (block.type !== "tool_use") continue;
        const def = DEFS.find((d) => d.name === block.name);
        const args = def?.inputSchema.safeParse(block.input);
        if (!def || !args?.success) {
          results.push({ type: "tool_result", tool_use_id: block.id, is_error: true,
            content: def ? `Invalid input: ${args?.error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` : `Unknown tool ${block.name}` });
          continue;
        }
        const out = await runTool(def, session, args.data);
        results.push({ type: "tool_result", tool_use_id: block.id, content: out.text, ...(out.ok ? {} : { is_error: true }) });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    const text = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    if (r.stop_reason === "refusal") return { reply: "Sorry, I can't help with that one.", history: messages };
    return { reply: text || "Done.", history: messages };
  }
  return { reply: "That took too many steps. Could you say it again more simply?", history: messages };
}
