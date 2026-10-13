// Runs the SQL tests on an in-memory Postgres (PGlite) with a minimal stand-in for what
// Supabase provides (auth.uid(), storage tables, API roles). No Docker, no network.
//
// npm run test:db                 all files in supabase/tests/
// npm run test:db -- rls_smoke.sql

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const SUPABASE_STANDIN = `
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
    name text not null, owner uuid default auth.uid(), unique (bucket_id, name));
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema auth, storage to anon, authenticated;
  grant all on storage.objects to authenticated;
  grant select on storage.buckets to authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(path.join(root, "tests")).filter((f) => f.endsWith(".sql")).sort();
const migrations = readdirSync(path.join(root, "migrations")).sort();

let failed = 0;
for (const file of files) {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (const m of migrations) await db.exec(readFileSync(path.join(root, "migrations", m), "utf8"));
  const notices = [];
  console.log(`# ${file}`);
  try {
    await db.exec(readFileSync(path.join(root, "tests", file), "utf8"), { onNotice: (n) => notices.push(n.message) });
  } catch (e) {
    failed++;
    notices.push(`✗ ${e.message}`);
  }
  for (const n of notices) console.log(`  ${n}`);
  await db.close();
}
console.log(failed ? `${failed} file(s) failed` : `all ${files.length} files passed`);
process.exit(failed ? 1 : 0);
