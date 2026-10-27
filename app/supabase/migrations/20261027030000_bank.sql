-- Splyce — bank module, short version: bank statements in, one list of lines out.
--
-- Flow:
--   1. An admin adds a statement (Danamon PDF read by Claude, Wise CSV parsed in the app) to an account.
--      The file goes to the private "bank" bucket; its lines to bank_lines (a line already seen in an
--      overlapping statement is skipped by its fingerprint).
--   2. Obvious matches with transactions already in the books are linked automatically.
--   3. What is left is the list "at the bank but not in the books": create the entry, link it by hand,
--      or mark the line personal (never in the books).
--
-- Everything here is admins only: a statement shows balances, account numbers of staff and suppliers,
-- and personal spending. Staff and owners see the entries created from it, never the statement.

create type public.bank_line_status as enum ('unmatched', 'matched', 'personal');

create table public.bank_accounts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  institution      text not null check (institution in ('danamon', 'wise', 'other')),
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  last4            text check (last4 ~ '^[0-9A-Za-z]{2,4}$'),  -- shown as •••• 1234; never the full number
  villa_id         uuid,                                       -- default villa for entries created from it
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  foreign key (villa_id, organization_id) references public.villas(id, organization_id) on delete set null (villa_id),
  unique (id, organization_id),
  unique (organization_id, institution, currency, last4)
);

create table public.bank_statements (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  account_id       uuid not null,
  -- Path in the private "bank" bucket: <organization_id>/<uuid>.<ext>
  storage_path     text not null unique check (storage_path like organization_id::text || '/%'),
  file_name        text,
  mime_type        text not null,
  period_start     date,
  period_end       date,
  opening_balance  numeric(18,2),
  closing_balance  numeric(18,2),
  balanced         boolean,                     -- opening + in − out = closing, when both are printed
  notes            text,                        -- what the reading flagged
  lines_added      integer not null default 0,
  lines_skipped    integer not null default 0,  -- already known from an earlier statement
  created_by       uuid references auth.users(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  foreign key (account_id, organization_id) references public.bank_accounts(id, organization_id) on delete cascade,
  unique (id, organization_id)
);

create table public.bank_lines (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  account_id       uuid not null,
  statement_id     uuid not null,
  date             date not null,
  direction        public.tx_direction not null,
  amount           numeric(18,2) not null check (amount > 0),
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  description      text not null default '',
  counterparty     text,                         -- name only; account numbers are masked before saving
  reference        text,
  balance          numeric(18,2),
  fingerprint      text not null,                -- same line in two overlapping statements → same fingerprint
  status           public.bank_line_status not null default 'unmatched',
  transaction_id   uuid,
  matched_by       text check (matched_by in ('auto', 'manual', 'created')),
  created_at       timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (account_id, organization_id)   references public.bank_accounts(id, organization_id) on delete cascade,
  foreign key (statement_id, organization_id) references public.bank_statements(id, organization_id) on delete cascade,
  foreign key (transaction_id, organization_id) references public.transactions(id, organization_id) on delete set null (transaction_id),
  unique (account_id, fingerprint),
  -- Matched to a transaction, or to stays through bank_line_stays (Airbnb payouts).
  check ((status = 'matched') = (matched_by is not null)),
  check (transaction_id is null or status = 'matched')
);

create index on public.bank_lines (organization_id, status, date);
-- Usually one line per transaction; a month's bank charges are booked as one entry for several lines.
create index on public.bank_lines (transaction_id) where transaction_id is not null;

-- Airbnb payouts: one transfer can pay several stays (one payout date), and one stay can be paid in
-- instalments (several transfers). The stay's income lines are already in the books; this only links them.
create table public.bank_line_stays (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  line_id          uuid not null,
  stay_id          uuid not null,
  primary key (line_id, stay_id),
  foreign key (line_id, organization_id) references public.bank_lines(id, organization_id) on delete cascade,
  foreign key (stay_id, organization_id) references public.stays(id, organization_id) on delete cascade
);
create index on public.bank_line_stays (stay_id);
-- Same when the last stay a payout line was linked to is deleted (e.g. a re-imported booking).
create function private.bank_line_stay_unlinked() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.bank_lines l set status = 'unmatched', matched_by = null
  where l.id = old.line_id and l.status = 'matched' and l.transaction_id is null
    and not exists (select 1 from public.bank_line_stays x where x.line_id = old.line_id);
  return null;
end $$;

create trigger bank_line_stay_unlinked after delete on public.bank_line_stays
  for each row execute function private.bank_line_stay_unlinked();

-- A line whose transaction is deleted goes back to the list.
create function private.bank_line_unlinked() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.transaction_id is null and old.transaction_id is not null and new.status = 'matched' then
    new.status := 'unmatched';
    new.matched_by := null;
  end if;
  return new;
end $$;
create trigger bank_line_unlinked before update of transaction_id on public.bank_lines
  for each row execute function private.bank_line_unlinked();

alter table public.bank_accounts   enable row level security;
alter table public.bank_statements enable row level security;
alter table public.bank_lines      enable row level security;
alter table public.bank_line_stays enable row level security;

create policy bank_accounts_admin on public.bank_accounts for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));
create policy bank_statements_admin on public.bank_statements for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));
create policy bank_lines_admin on public.bank_lines for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));
create policy bank_line_stays_admin on public.bank_line_stays for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));

-- Storage: its own private bucket, admins only (the evidence bucket is readable by staff).
insert into storage.buckets (id, name, public)
values ('bank', 'bank', false)
on conflict (id) do nothing;

create policy bank_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'bank' and private.is_admin(((storage.foldername(name))[1])::uuid));
create policy bank_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'bank' and private.is_admin(((storage.foldername(name))[1])::uuid));
create policy bank_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'bank' and private.is_admin(((storage.foldername(name))[1])::uuid));

-- AI quota: a PDF statement read by Claude counts as one 'bank_statement' (default 20 a month).
alter table private.ai_usage drop constraint ai_usage_kind_check;
alter table private.ai_usage add constraint ai_usage_kind_check
  check (kind in ('receipt', 'agent_message', 'voice_minute', 'bank_statement'));
alter table private.ai_limits add column bank_statement integer check (bank_statement >= 0);

create or replace function private.ai_limit(org uuid, k text)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select case k when 'receipt' then l.receipt when 'agent_message' then l.agent_message
                   when 'voice_minute' then l.voice_minute else l.bank_statement end
     from private.ai_limits l where l.organization_id = org),
    case k when 'receipt' then 100 when 'agent_message' then 300 when 'voice_minute' then 60 else 20 end)
$$;

create or replace function public.ai_take(org uuid, k text, wanted integer default 1)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  m date := private.ai_month(org);
  cap integer := private.ai_limit(org, k);
  granted integer;
begin
  if not private.is_member(org) then
    raise exception 'Not a member of this organization' using errcode = 'insufficient_privilege';
  end if;
  if k not in ('receipt', 'agent_message', 'voice_minute', 'bank_statement') then raise exception 'Unknown quota %', k; end if;
  if wanted is null or wanted <= 0 then return 0; end if;

  insert into private.ai_usage (organization_id, month, kind) values (org, m, k)
  on conflict do nothing;
  -- The row lock serializes concurrent calls, so two readers never both get the last units.
  select least(wanted, greatest(cap - u.used, 0)) into granted
  from private.ai_usage u where u.organization_id = org and u.month = m and u.kind = k
  for update;
  update private.ai_usage u set used = u.used + granted
  where u.organization_id = org and u.month = m and u.kind = k;
  return granted;
end $$;

create or replace function public.ai_quota(org uuid)
returns table (kind text, used integer, quota integer, month date)
language sql stable security definer set search_path = ''
as $$
  select k, coalesce(u.used, 0), private.ai_limit(org, k), private.ai_month(org)
  from unnest(array['receipt', 'agent_message', 'voice_minute', 'bank_statement']) k
  left join private.ai_usage u on u.organization_id = org and u.month = private.ai_month(org) and u.kind = k
  where private.is_member(org)
$$;
