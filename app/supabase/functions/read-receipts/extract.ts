// Reads one receipt (photo or PDF) with Claude and returns structured fields.
// Pure apart from the Claude call, so it can be tested with a stub client.

import Anthropic from "npm:@anthropic-ai/sdk@^0.131.0";

export const MODEL = Deno.env.get("RECEIPT_MODEL") ?? "claude-opus-5-5";
const EFFORT = (Deno.env.get("RECEIPT_EFFORT") ?? "medium") as "low" | "medium" | "high";

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

export interface ReceiptContext {
  /** Expense and income category names of the organization. */
  categories: string[];
  /** Villa names of the organization; used only when the receipt names one. */
  villas: string[];
  /** Currency the villas usually spend in, e.g. "IDR". */
  defaultCurrency: string;
}

export interface Extracted {
  is_receipt: boolean;
  merchant: string | null;
  date: string | null;
  currency: string | null;
  total: number | null;
  tax: number | null;
  description: string;
  category: string | null;
  villa: string | null;
  confidence: number;
  notes: string | null;
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

export function outputSchema(ctx: ReceiptContext) {
  return {
    type: "object",
    properties: {
      is_receipt: { type: "boolean" },
      merchant: nullable({ type: "string" }),
      date: nullable({ type: "string", format: "date" }),
      currency: nullable({ type: "string" }),
      total: nullable({ type: "number" }),
      tax: nullable({ type: "number" }),
      description: { type: "string" },
      category: ctx.categories.length ? nullable({ type: "string", enum: ctx.categories }) : { type: "null" },
      villa: ctx.villas.length ? nullable({ type: "string", enum: ctx.villas }) : { type: "null" },
      confidence: { type: "number" },
      notes: nullable({ type: "string" }),
    },
    required: [
      "is_receipt", "merchant", "date", "currency", "total", "tax",
      "description", "category", "villa", "confidence", "notes",
    ],
    additionalProperties: false,
  };
}

export function systemPrompt(ctx: ReceiptContext): string {
  return `You read receipts for the bookkeeping of short-term-rental villas.

Receipts come from phone photos and PDFs: shop tickets, handwritten notes (nota), invoices,
utility bills, transfer slips. Many are from Indonesia and partly in Indonesian; others
from Australia or elsewhere.

Return the fields of the schema:
- total: the amount actually paid, as a plain number. Watch the separators: in Indonesia
  "Rp 150.000" and "150.000,-" mean one hundred fifty thousand, and "1.250.000" is
  1250000. Prefer the grand total over subtotals; include tax and service if they are paid.
- currency: ISO 4217 code. If none is printed, use ${ctx.defaultCurrency} when the amounts
  and context fit, and say so in notes.
- date: the purchase date as YYYY-MM-DD. Indonesian receipts write day before month.
  null if absent or unreadable.
- description: a short English label of what was bought (e.g. "Pool chlorine, 2 kg").
- category: the best match among the organization's categories, or null if none fits.
- villa: only if the receipt itself names one of the organization's villas; otherwise null.
- confidence: 0 to 1, how sure you are of total, date and currency together.
- notes: anything a reviewer should check (blurry digits, crossed-out amounts, two
  receipts in one photo, possible duplicate copy). null if nothing.
- is_receipt: false if the file is not a receipt or proof of payment; then leave the
  other fields null and explain in notes.

Never guess a digit you cannot read: lower the confidence and say which one in notes.`;
}

export type ReceiptFile = { mimeType: string; base64: string };

function fileBlock(file: ReceiptFile): Anthropic.Beta.BetaContentBlockParam {
  if (file.mimeType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.base64 } };
  }
  if ((IMAGE_TYPES as readonly string[]).includes(file.mimeType)) {
    return { type: "image", source: { type: "base64", media_type: file.mimeType as ImageType, data: file.base64 } };
  }
  throw new UnsupportedFileError(file.mimeType);
}

export class UnsupportedFileError extends Error {
  constructor(mimeType: string) {
    super(`Unsupported file type ${mimeType}; use JPEG, PNG, WebP, GIF or PDF`);
  }
}

export class ExtractionError extends Error {}

/** The subset of the SDK client this module uses, so tests can pass a stub. */
export interface MessagesClient {
  beta: { messages: { create: Anthropic["beta"]["messages"]["create"] } };
}

export async function extractReceipt(
  client: MessagesClient,
  file: ReceiptFile,
  ctx: ReceiptContext,
): Promise<Extracted> {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: systemPrompt(ctx),
    output_config: {
      effort: EFFORT,
      format: { type: "json_schema", schema: outputSchema(ctx) },
    },
    messages: [{
      role: "user",
      content: [fileBlock(file), { type: "text", text: "Read this receipt." }],
    }],
  });

  if (response.stop_reason === "refusal") {
    throw new ExtractionError(`Model declined to read this file (${response.stop_details?.category ?? "no category"})`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new ExtractionError("Model output was cut off");
  }

  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ExtractionError("Model returned invalid JSON");
  }
  return normalize(parsed, ctx);
}

/** Defensive checks on top of the schema: values the reviewer UI relies on. */
export function normalize(raw: unknown, ctx: ReceiptContext): Extracted {
  const r = raw as Extracted;
  const out: Extracted = { ...r };
  out.confidence = Math.min(1, Math.max(0, Number(r.confidence) || 0));
  if (out.currency !== null) {
    out.currency = String(out.currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(out.currency)) {
      out.notes = [out.notes, `Unrecognised currency "${r.currency}"`].filter(Boolean).join(" · ");
      out.currency = null;
    }
  }
  if (out.date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(out.date) || isNaN(Date.parse(out.date)))) {
    out.notes = [out.notes, `Unreadable date "${r.date}"`].filter(Boolean).join(" · ");
    out.date = null;
  }
  if (out.total !== null && !(out.total > 0)) out.total = null;
  if (out.category !== null && !ctx.categories.includes(out.category)) out.category = null;
  if (out.villa !== null && !ctx.villas.includes(out.villa)) out.villa = null;
  return out;
}
