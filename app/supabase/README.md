# Database (Supabase)

- `migrations/` — schema, applied in order by `supabase db push` / `supabase migration up`.
- `functions/` — Edge Functions (Deno).
- `tests/*.sql` — tenant isolation, roles, closed months, receipt engine. Each file runs as a
  superuser inside a transaction that is rolled back and raises `FAILED: …` on the first broken
  check: `psql "$DB_URL" -f tests/rls_smoke.sql` against a local `supabase start`.
- `functions/read-receipts/extract_test.ts` — `deno test --allow-env functions/read-receipts/`
  (no network: the Claude client is stubbed).

## Core model (v0.1)

`organizations` → `villas` → `villa_ownerships` ← `owners`, with `memberships` giving each
user one role per organization: `admin`, `staff` or `owner_viewer` (read-only, limited to the
villas their owner holds a share in, validated figures only).

`transactions` is the pivot: stays, receipts, adjustments and future modules all end up there.
Amounts keep their original currency plus the rate to the reporting currency on the day.

A villa's month marked `closed` in `month_closes` rejects any insert, update or delete dated in
that month; corrections go in as `source = 'adjustment'` rows in an open month.

## Receipt engine

1. The app creates a `receipt_batch`, uploads each photo or PDF to the private `evidence`
   bucket under `<organization_id>/<uuid>.<ext>`, and inserts one `evidence` row and one
   `receipt_item` per file.
2. It calls the `read-receipts` Edge Function with `{ batch_id }` and the user's JWT. The function
   runs with the caller's rights, reads up to 20 unread items with Claude (4 at a time), stores
   the fields in `receipt_items.proposed` and `evidence.extracted` (including `uncertain_fields`
   for the reviewer to check, and `printed_total` when a handwritten claim differs from the
   printed total), follows how the organization categorized its last 40 distinct receipts,
   flags a possible duplicate
   (same date, currency and amount already in the books), and moves the batch to `to_review`.
   Call it again while `remaining > 0`; rate limits and API outages leave the item unread for
   the next call, other failures are recorded as `proposed.error`.
3. A person reviews each item: `accept_receipt_item(...)` with any corrections creates a
   validated transaction and attaches the file; `reject_receipt_item(...)` discards it.
   Nothing reaches the books without review, and closed months still refuse new rows.

Owner viewers can open a file only once it backs a validated transaction in one of their villas.

Function secrets: `ANTHROPIC_API_KEY` (required), `RECEIPT_MODEL` (default `claude-opus-5-5`),
`RECEIPT_EFFORT` (default `medium`). Requests use server-side refusal fallbacks
(`fallbacks: "default"`). Accepted files: JPEG, PNG, WebP, GIF, PDF. iPhone HEIC photos must be
converted, and large photos resized, in the app before upload.

Not yet covered: exchange rates (the reviewer supplies `fx_rate` for now), Stripe, and the
manager layer (management fees, branded statements, statement e-mails).
