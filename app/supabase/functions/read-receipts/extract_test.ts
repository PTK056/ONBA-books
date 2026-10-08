// deno test app/supabase/functions/read-receipts/ — no network, the Claude client is stubbed.

import { assertEquals, assertRejects } from "jsr:@std/assert@^1";
import {
  ExtractionError,
  extractReceipt,
  type MessagesClient,
  normalize,
  outputSchema,
  type ReceiptContext,
  UnsupportedFileError,
} from "./extract.ts";

const ctx: ReceiptContext = {
  categories: ["Utilities", "Pool & garden", "Other expenses"],
  villas: ["Casa Test"],
  defaultCurrency: "IDR",
};

const good = {
  is_receipt: true,
  merchant: "Toko Kolam",
  date: "2026-09-14",
  currency: "IDR",
  total: 150000,
  tax: null,
  description: "Pool chlorine, 2 kg",
  category: "Pool & garden",
  villa: null,
  confidence: 0.92,
  notes: null,
};

function stub(reply: Record<string, unknown>, calls: unknown[] = []): MessagesClient {
  return {
    beta: {
      messages: {
        // deno-lint-ignore no-explicit-any
        create: ((params: unknown) => {
          calls.push(params);
          return Promise.resolve({ stop_reason: "end_turn", content: [], ...reply });
        }) as any,
      },
    },
  };
}

const jpeg = { mimeType: "image/jpeg", base64: "AAAA" };

Deno.test("returns the parsed fields", async () => {
  const calls: Record<string, unknown>[] = [];
  const out = await extractReceipt(
    stub({ content: [{ type: "text", text: JSON.stringify(good) }] }, calls),
    jpeg,
    ctx,
  );
  assertEquals(out, good);
  // Request shape: image block first, structured output, server-side fallback on.
  const req = calls[0] as Record<string, any>;
  assertEquals(req.messages[0].content[0].type, "image");
  assertEquals(req.output_config.format.type, "json_schema");
  assertEquals(req.fallbacks, "default");
});

Deno.test("sends PDFs as document blocks", async () => {
  const calls: Record<string, any>[] = [];
  await extractReceipt(
    stub({ content: [{ type: "text", text: JSON.stringify(good) }] }, calls),
    { mimeType: "application/pdf", base64: "AAAA" },
    ctx,
  );
  assertEquals(calls[0].messages[0].content[0].type, "document");
});

Deno.test("rejects unsupported files before calling the API", async () => {
  const calls: unknown[] = [];
  await assertRejects(
    () => extractReceipt(stub({}, calls), { mimeType: "image/heic", base64: "AAAA" }, ctx),
    UnsupportedFileError,
  );
  assertEquals(calls.length, 0);
});

Deno.test("surfaces refusals and truncation as extraction errors", async () => {
  await assertRejects(
    () => extractReceipt(stub({ stop_reason: "refusal", stop_details: { category: "bio" } }), jpeg, ctx),
    ExtractionError,
    "declined",
  );
  await assertRejects(
    () => extractReceipt(stub({ stop_reason: "max_tokens" }), jpeg, ctx),
    ExtractionError,
    "cut off",
  );
  await assertRejects(
    () => extractReceipt(stub({ content: [{ type: "text", text: "{not json" }] }), jpeg, ctx),
    ExtractionError,
    "invalid JSON",
  );
});

Deno.test("normalize cleans values the schema cannot constrain", () => {
  const out = normalize(
    { ...good, currency: " idr ", confidence: 1.7, date: "14/09/2026", total: -5, category: "Groceries", villa: "Elsewhere" },
    ctx,
  );
  assertEquals(out.currency, "IDR");
  assertEquals(out.confidence, 1);
  assertEquals(out.date, null);
  assertEquals(out.total, null);
  assertEquals(out.category, null);
  assertEquals(out.villa, null);
  assertEquals(out.notes, 'Unreadable date "14/09/2026"');

  const bad = normalize({ ...good, currency: "Rupiah" }, ctx);
  assertEquals(bad.currency, null);
  assertEquals(bad.notes, 'Unrecognised currency "Rupiah"');
});

Deno.test("schema lists the organization's categories and villas", () => {
  const s = outputSchema(ctx) as any;
  assertEquals(s.properties.category.anyOf[0].enum, ctx.categories);
  assertEquals(s.properties.villa.anyOf[0].enum, ctx.villas);
  assertEquals(s.required.length, Object.keys(s.properties).length);
  // An organization without villas yet: the field must be null, not an empty enum.
  assertEquals((outputSchema({ ...ctx, villas: [] }) as any).properties.villa, { type: "null" });
});
