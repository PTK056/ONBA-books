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
  /** How this organization categorized recent receipts, newest first. */
  history?: { label: string; category: string }[];
}

export const DOCUMENT_TYPES = ["receipt", "invoice", "transfer_slip", "bank_statement", "other"] as const;

export const CHECKABLE_FIELDS = ["date", "total", "currency", "merchant", "category"] as const;

export interface Extracted {
  is_receipt: boolean;
  document_type: (typeof DOCUMENT_TYPES)[number];
  merchant: string | null;
  date: string | null;
  currency: string | null;
  total: number | null;
  printed_total: number | null;
  tax: number | null;
  description: string;
  category: string | null;
  villa: string | null;
  uncertain_fields: (typeof CHECKABLE_FIELDS)[number][];
  confidence: number;
  notes: string | null;
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

export function outputSchema(ctx: ReceiptContext) {
  return {
    type: "object",
    properties: {
      is_receipt: { type: "boolean" },
      document_type: { type: "string", enum: [...DOCUMENT_TYPES] },
      merchant: nullable({ type: "string" }),
      date: nullable({ type: "string", format: "date" }),
      currency: nullable({ type: "string" }),
      total: nullable({ type: "number" }),
      printed_total: nullable({ type: "number" }),
      tax: nullable({ type: "number" }),
      description: { type: "string" },
      category: ctx.categories.length ? nullable({ type: "string", enum: ctx.categories }) : { type: "null" },
      villa: ctx.villas.length ? nullable({ type: "string", enum: ctx.villas }) : { type: "null" },
      uncertain_fields: { type: "array", items: { type: "string", enum: [...CHECKABLE_FIELDS] } },
      confidence: { type: "number" },
      notes: nullable({ type: "string" }),
    },
    required: [
      "is_receipt", "document_type", "merchant", "date", "currency", "total", "printed_total", "tax",
      "description", "category", "villa", "uncertain_fields", "confidence", "notes",
    ],
    additionalProperties: false,
  };
}

export function systemPrompt(ctx: ReceiptContext): string {
  const history = ctx.history?.length
    ? `

How this organization categorized its recent receipts (follow these habits over your own
judgment when the purchase is similar):
${ctx.history.map((h) => `- ${h.label} → ${h.category}`).join("\n")}`
    : "";

  return `You read receipts for the bookkeeping of short-term-rental villas.

Receipts come from phone photos and PDFs: shop tickets, handwritten notes (nota), invoices,
utility bills, transfer slips. Many are from Indonesia and partly in Indonesian; others
from Australia or elsewhere.

Return the fields of the schema:
- total: the amount the villa should book, as a plain number. Watch the separators: in
  Indonesia "Rp 150.000" and "150.000,-" mean one hundred fifty thousand, and "1.250.000"
  is 1250000. Prefer the grand total over subtotals; include tax and service if paid.
  If someone has marked the receipt by hand to claim only part of it (items crossed out,
  amounts rewritten, a handwritten total), book that handwritten amount.
- printed_total: the printed grand total, only when it differs from total; otherwise null.
- currency: ISO 4217 code. If none is printed, use ${ctx.defaultCurrency} when the amounts
  and context fit.
- date: the purchase date as YYYY-MM-DD. Indonesian receipts write day before month.
  Handwritten 4s are often open at the top and look like a 7 or a Y. If a digit is
  ambiguous, give the most likely reading and list date in uncertain_fields; use null only
  when a digit is missing (cut off, hidden, torn).
- merchant: the shop or seller name as printed or written; null if there is none (common on
  handwritten nota). A missing name is not something to check or mention.
- description: a short English label of what was bought (e.g. "Pool chlorine, 2 kg").
- category: the best match among the organization's categories, or null if none fits.
- villa: only if the receipt itself names one of the organization's villas; otherwise null.
- uncertain_fields: the fields a reviewer must check because you could not read them with
  certainty or had to choose between readings. Empty when everything is clearly legible.
  Do not list category just because several categories could fit; list it only if you
  could not tell what was bought.
- confidence: 0 to 1 for total, date and currency together. Use 0.95 or more when all three
  are clearly legible (handwriting included), around 0.7 when one needed a judgment call,
  0.5 or less when one is a guess or missing.
- notes: one or two short sentences, only about what the reviewer must act on: a doubtful
  digit and its alternatives, a handwritten total that differs from the printed one, a
  duplicate copy, two receipts in one photo, a purchase worth splitting across categories.
  Do not explain readings that are clear, do not justify the currency or the category.
  null if there is nothing to act on.
- document_type: receipt (shop ticket or handwritten nota), invoice (including utility
  bills), transfer_slip (proof of a single payment), bank_statement (a list of account
  movements over a period), or other.
- is_receipt: true for a receipt, invoice or transfer slip that records one expense. False
  for a bank statement or anything else; then leave the amount, date and category fields
  null and say in one sentence what the file is.

Never guess a digit you cannot read.${history}`;
}

export type ReceiptFile = { mimeType: string; base64: string };

function fileBlock(file: ReceiptFile): Anthropic.Beta.BetaContentBlockParam {
  if (file.mimeType === "application/pdf") {
    if (isEncryptedPdf(file.base64)) throw new UnsupportedFileError(file.mimeType, "encrypted");
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.base64 } };
  }
  if ((IMAGE_TYPES as readonly string[]).includes(file.mimeType)) {
    return { type: "image", source: { type: "base64", media_type: file.mimeType as ImageType, data: file.base64 } };
  }
  throw new UnsupportedFileError(file.mimeType);
}

export class UnsupportedFileError extends Error {
  constructor(mimeType: string, reason: "type" | "encrypted" = "type") {
    super(
      reason === "encrypted"
        ? "This PDF is password-protected. Remove the password (open it, then save or export a copy) and upload it again."
        : `Unsupported file type ${mimeType}; use JPEG, PNG, WebP, GIF or PDF`,
    );
  }
}

/** A PDF with an /Encrypt entry in its trailer cannot be read without the password. */
export function isEncryptedPdf(base64: string): boolean {
  const bin = atob(base64);
  // The trailer (or cross-reference stream dictionary) sits at the end of the file;
  // incremental updates can add more, so scan the whole file but stop at the first hit.
  return /\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(bin);
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
  out.uncertain_fields = (r.uncertain_fields ?? []).filter((f) => CHECKABLE_FIELDS.includes(f));
  const flag = (f: (typeof CHECKABLE_FIELDS)[number]) => {
    if (!out.uncertain_fields.includes(f)) out.uncertain_fields.push(f);
  };
  out.confidence = Math.min(1, Math.max(0, Number(r.confidence) || 0));
  if (out.currency !== null) {
    out.currency = String(out.currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(out.currency)) {
      out.notes = [out.notes, `Unrecognised currency "${r.currency}"`].filter(Boolean).join(" · ");
      out.currency = null;
      flag("currency");
    }
  }
  if (out.date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(out.date) || isNaN(Date.parse(out.date)))) {
    out.notes = [out.notes, `Unreadable date "${r.date}"`].filter(Boolean).join(" · ");
    out.date = null;
    flag("date");
  }
  if (out.total !== null && !(out.total > 0)) {
    out.total = null;
    flag("total");
  }
  if (out.printed_total === out.total) out.printed_total = null;
  if (out.category !== null && !ctx.categories.includes(out.category)) out.category = null;
  if (out.villa !== null && !ctx.villas.includes(out.villa)) out.villa = null;
  return out;
}
