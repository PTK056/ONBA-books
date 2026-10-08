# Database (Supabase)

- `migrations/` — schema, applied in order by `supabase db push` / `supabase migration up`.
- `tests/rls_smoke.sql` — tenant isolation, roles and closed-month checks. Runs as a
  superuser inside a transaction that is rolled back; raises `FAILED: …` on the first broken check.

## Core model (v0.1)

`organizations` → `villas` → `villa_ownerships` ← `owners`, with `memberships` giving each
user one role per organization: `admin`, `staff` or `owner_viewer` (read-only, limited to the
villas their owner holds a share in, validated figures only).

`transactions` is the pivot: stays, receipts, adjustments and future modules all end up there.
Amounts keep their original currency plus the rate to the reporting currency on the day.

A villa's month marked `closed` in `month_closes` rejects any insert, update or delete dated in
that month; corrections go in as `source = 'adjustment'` rows in an open month.

Not yet covered: Storage bucket policies for `evidence`, the receipt engine (Edge Function),
Stripe, and the manager layer (management fees, branded statements, statement e-mails).
