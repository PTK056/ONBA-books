# ONBA Books — web app

Next.js 16 (App Router, Cache Components) on Supabase. The database, its tests and the
receipt engine live in [`supabase/`](supabase/README.md).

## Run locally

```bash
cp .env.example .env.local   # then fill in the Supabase project URL and publishable key
npm install
npm run dev
```

- `/login` — e-mail sign-in link (accounts are created by invitation).
- `/review` — receipts read by the engine, waiting for a person to accept or reject them.

## Preview without Supabase

`/dev/review` (development only) renders the review screen from local fixtures:
`public/dev-fixtures/review.json` plus the files it points to. That folder is git-ignored
because it holds real receipts. Accept and reject are logged to the server console.
