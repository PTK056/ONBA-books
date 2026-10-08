-- ONBA Books — core schema (v0.1)
--
-- Every business table carries organization_id; access is enforced by Row Level
-- Security. Cross-table references use composite foreign keys (id, organization_id)
-- so a row can never point at another organization's data.
--
-- Roles inside an organization:
--   admin         full access, manages settings, members and month closes
--   staff         enters and validates data, cannot change settings or members
--   owner_viewer  read-only, limited to the villas the linked owner holds a share in
--
-- Modules (bank reconciliation, payroll, advances, ask) add their own tables in
-- later migrations and never alter the core tables.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.member_role      as enum ('admin', 'staff', 'owner_viewer');
create type public.category_kind    as enum ('income', 'expense');
create type public.stay_platform    as enum ('airbnb', 'booking', 'vrbo', 'direct', 'other');
create type public.tx_direction     as enum ('in', 'out');
create type public.tx_status        as enum ('draft', 'validated');
create type public.tx_source        as enum ('manual', 'receipt', 'stay', 'adjustment', 'module');
create type public.month_status     as enum ('open', 'in_review', 'closed');
create type public.batch_status     as enum ('processing', 'to_review', 'done');
create type public.item_status      as enum ('pending', 'accepted', 'rejected');

-- ---------------------------------------------------------------------------
-- Organizations and members
-- ---------------------------------------------------------------------------

create table public.organizations (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (length(trim(name)) > 0),
  reporting_currency   char(3) not null default 'USD' check (reporting_currency ~ '^[A-Z]{3}$'),
  timezone             text not null default 'Asia/Makassar',
  locale               text not null default 'en',
  fiscal_year_start    smallint not null default 1 check (fiscal_year_start between 1 and 12),
  -- Evidence is required for expenses at or above this amount (reporting currency).
  evidence_threshold   numeric(18,2) not null default 0 check (evidence_threshold >= 0),
  settings             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);

create table public.owners (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  email            text,
  created_at       timestamptz not null default now(),
  unique (id, organization_id)
);

create table public.memberships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  role             public.member_role not null,
  -- For owner_viewer: which owner this user reads as.
  owner_id         uuid,
  created_at       timestamptz not null default now(),
  unique (organization_id, user_id),
  foreign key (owner_id, organization_id) references public.owners(id, organization_id) on delete cascade,
  check ((role = 'owner_viewer') = (owner_id is not null))
);

create table public.module_activations (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  module           text not null check (module in ('advances', 'bank', 'payroll', 'ask')),
  enabled          boolean not null default true,
  settings         jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now(),
  primary key (organization_id, module)
);

-- ---------------------------------------------------------------------------
-- Villas and ownership
-- ---------------------------------------------------------------------------

create table public.villas (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (id, organization_id)
);

create table public.villa_ownerships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  villa_id         uuid not null,
  owner_id         uuid not null,
  share_pct        numeric(5,2) not null check (share_pct > 0 and share_pct <= 100),
  valid_from       date not null default current_date,
  valid_to         date,
  foreign key (villa_id, organization_id) references public.villas(id, organization_id) on delete cascade,
  foreign key (owner_id, organization_id) references public.owners(id, organization_id) on delete cascade,
  unique (villa_id, owner_id, valid_from),
  check (valid_to is null or valid_to >= valid_from)
);

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

create table public.categories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  kind             public.category_kind not null,
  name             text not null check (length(trim(name)) > 0),
  archived_at      timestamptz,
  unique (organization_id, kind, name),
  unique (id, organization_id)
);

-- ---------------------------------------------------------------------------
-- Month closes
-- ---------------------------------------------------------------------------

create table public.month_closes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  villa_id         uuid not null,
  month            date not null check (month = date_trunc('month', month)::date),
  status           public.month_status not null default 'open',
  closed_by        uuid references auth.users(id),
  closed_at        timestamptz,
  foreign key (villa_id, organization_id) references public.villas(id, organization_id) on delete cascade,
  unique (villa_id, month),
  check ((status = 'closed') = (closed_at is not null))
);

-- ---------------------------------------------------------------------------
-- Stays (bookings)
-- ---------------------------------------------------------------------------

create table public.stays (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  villa_id         uuid not null,
  platform         public.stay_platform not null,
  external_ref     text,
  guest_name       text,
  check_in         date not null,
  check_out        date not null,
  nights           integer generated always as (check_out - check_in) stored,
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  gross_amount     numeric(18,2) not null check (gross_amount >= 0),
  platform_fees    numeric(18,2) not null default 0 check (platform_fees >= 0),
  net_amount       numeric(18,2) generated always as (gross_amount - platform_fees) stored,
  payout_date      date,
  created_at       timestamptz not null default now(),
  foreign key (villa_id, organization_id) references public.villas(id, organization_id) on delete cascade,
  unique (villa_id, platform, external_ref),
  unique (id, organization_id),
  check (check_out > check_in)
);

-- ---------------------------------------------------------------------------
-- Transactions: the pivot. Every module ends up writing here.
-- ---------------------------------------------------------------------------

create table public.transactions (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations(id) on delete cascade,
  villa_id                uuid not null,
  date                    date not null,
  direction               public.tx_direction not null,
  category_id             uuid,
  description             text,
  currency                char(3) not null check (currency ~ '^[A-Z]{3}$'),
  amount                  numeric(18,2) not null check (amount > 0),
  -- Rate to the organization's reporting currency on the transaction date; never recomputed.
  fx_rate                 numeric(20,10) not null default 1 check (fx_rate > 0),
  amount_reporting        numeric(18,2) generated always as (round(amount * fx_rate, 2)) stored,
  status                  public.tx_status not null default 'draft',
  source                  public.tx_source not null default 'manual',
  stay_id                 uuid,
  -- An adjustment corrects a transaction in a closed month, dated in an open month.
  adjusts_transaction_id  uuid,
  created_by              uuid references auth.users(id) default auth.uid(),
  created_at              timestamptz not null default now(),
  foreign key (villa_id, organization_id)    references public.villas(id, organization_id) on delete cascade,
  foreign key (category_id, organization_id) references public.categories(id, organization_id),
  foreign key (stay_id, organization_id)     references public.stays(id, organization_id) on delete set null (stay_id),
  foreign key (adjusts_transaction_id, organization_id) references public.transactions(id, organization_id),
  unique (id, organization_id),
  check ((source = 'adjustment') = (adjusts_transaction_id is not null))
);

create index on public.transactions (villa_id, date);
create index on public.transactions (organization_id, date);

-- ---------------------------------------------------------------------------
-- Evidence and the receipt engine
-- ---------------------------------------------------------------------------

create table public.evidence (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  transaction_id   uuid,
  -- Path in the Supabase Storage bucket "evidence": <organization_id>/<uuid>.<ext>
  storage_path     text not null unique,
  mime_type        text not null,
  extracted        jsonb,
  confidence       numeric(4,3) check (confidence between 0 and 1),
  uploaded_by      uuid references auth.users(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  foreign key (transaction_id, organization_id) references public.transactions(id, organization_id) on delete set null (transaction_id),
  unique (id, organization_id),
  check (storage_path like organization_id::text || '/%')
);

create index on public.evidence (transaction_id);

create table public.receipt_batches (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  villa_id         uuid,
  status           public.batch_status not null default 'processing',
  created_by       uuid references auth.users(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  foreign key (villa_id, organization_id) references public.villas(id, organization_id) on delete cascade,
  unique (id, organization_id)
);

create table public.receipt_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  batch_id         uuid not null,
  evidence_id      uuid not null,
  -- What the AI read: {date, amount, currency, category, description, villa_id}
  proposed         jsonb not null default '{}'::jsonb,
  status           public.item_status not null default 'pending',
  transaction_id   uuid,
  reviewed_by      uuid references auth.users(id),
  reviewed_at      timestamptz,
  foreign key (batch_id, organization_id)       references public.receipt_batches(id, organization_id) on delete cascade,
  foreign key (evidence_id, organization_id)    references public.evidence(id, organization_id) on delete cascade,
  foreign key (transaction_id, organization_id) references public.transactions(id, organization_id) on delete set null (transaction_id),
  check (status <> 'accepted' or transaction_id is not null)
);

-- ---------------------------------------------------------------------------
-- Owner statements
-- ---------------------------------------------------------------------------

create table public.owner_statements (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  villa_id         uuid not null,
  owner_id         uuid not null,
  month            date not null check (month = date_trunc('month', month)::date),
  totals           jsonb not null,
  pdf_path         text,
  generated_at     timestamptz not null default now(),
  sent_at          timestamptz,
  foreign key (villa_id, organization_id) references public.villas(id, organization_id) on delete cascade,
  foreign key (owner_id, organization_id) references public.owners(id, organization_id) on delete cascade,
  unique (villa_id, owner_id, month)
);

-- ---------------------------------------------------------------------------
-- Audit log (written by trigger only)
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  table_name       text not null,
  row_id           uuid not null,
  action           text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor            uuid,
  at               timestamptz not null default now(),
  old_row          jsonb,
  new_row          jsonb
);

create index on public.audit_log (organization_id, at desc);

-- ---------------------------------------------------------------------------
-- Access helpers (private schema: not exposed through the API)
-- ---------------------------------------------------------------------------

create function private.role_in(org uuid)
returns public.member_role
language sql stable security definer set search_path = ''
as $$
  select m.role from public.memberships m
  where m.organization_id = org and m.user_id = auth.uid()
$$;

create function private.is_member(org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.role_in(org) is not null
$$;

create function private.is_editor(org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.role_in(org) in ('admin', 'staff'), false)
$$;

create function private.is_admin(org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.role_in(org) = 'admin', false)
$$;

-- The owner the current user reads as in this organization (owner_viewer only).
create function private.my_owner(org uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.owner_id from public.memberships m
  where m.organization_id = org and m.user_id = auth.uid() and m.role = 'owner_viewer'
$$;

create function private.can_see_villa(villa uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.villas v
    join public.memberships m
      on m.organization_id = v.organization_id and m.user_id = auth.uid()
    where v.id = villa
      and (
        m.role in ('admin', 'staff')
        or exists (
          select 1 from public.villa_ownerships o
          where o.villa_id = v.id and o.owner_id = m.owner_id
        )
      )
  )
$$;

grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.organizations      enable row level security;
alter table public.owners             enable row level security;
alter table public.memberships        enable row level security;
alter table public.module_activations enable row level security;
alter table public.villas             enable row level security;
alter table public.villa_ownerships   enable row level security;
alter table public.categories         enable row level security;
alter table public.month_closes       enable row level security;
alter table public.stays              enable row level security;
alter table public.transactions       enable row level security;
alter table public.evidence           enable row level security;
alter table public.receipt_batches    enable row level security;
alter table public.receipt_items      enable row level security;
alter table public.owner_statements   enable row level security;
alter table public.audit_log          enable row level security;

-- Organizations: created through public.create_organization() only.
create policy org_select on public.organizations for select to authenticated
  using (private.is_member(id));
create policy org_update on public.organizations for update to authenticated
  using (private.is_admin(id)) with check (private.is_admin(id));

-- Members: everyone sees their own membership; admins see and manage all.
create policy mem_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or private.is_admin(organization_id));
create policy mem_write on public.memberships for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));

-- Owners and shares: editors see all; an owner_viewer sees only themself.
create policy own_select on public.owners for select to authenticated
  using (private.is_editor(organization_id) or id = private.my_owner(organization_id));
create policy own_write on public.owners for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));

create policy vo_select on public.villa_ownerships for select to authenticated
  using (private.is_editor(organization_id) or owner_id = private.my_owner(organization_id));
create policy vo_write on public.villa_ownerships for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));

-- Settings-like tables: members read, admins write.
create policy mod_select on public.module_activations for select to authenticated
  using (private.is_member(organization_id));
create policy mod_write on public.module_activations for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));

create policy cat_select on public.categories for select to authenticated
  using (private.is_member(organization_id));
create policy cat_write on public.categories for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));

-- Villas
create policy villa_select on public.villas for select to authenticated
  using (private.can_see_villa(id));
create policy villa_write on public.villas for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));

-- Villa-scoped data: visible per villa, written by editors.
create policy mc_select on public.month_closes for select to authenticated
  using (private.can_see_villa(villa_id));
create policy mc_write on public.month_closes for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));

create policy stay_select on public.stays for select to authenticated
  using (private.can_see_villa(villa_id));
create policy stay_write on public.stays for all to authenticated
  using (private.is_editor(organization_id)) with check (private.is_editor(organization_id));

-- Owner viewers only see validated figures.
create policy tx_select on public.transactions for select to authenticated
  using (
    private.is_editor(organization_id)
    or (status = 'validated' and private.can_see_villa(villa_id))
  );
create policy tx_write on public.transactions for all to authenticated
  using (private.is_editor(organization_id)) with check (private.is_editor(organization_id));

create policy ev_select on public.evidence for select to authenticated
  using (
    private.is_editor(organization_id)
    or exists (
      select 1 from public.transactions t
      where t.id = transaction_id and t.status = 'validated' and private.can_see_villa(t.villa_id)
    )
  );
create policy ev_write on public.evidence for all to authenticated
  using (private.is_editor(organization_id)) with check (private.is_editor(organization_id));

-- Receipt engine: editors only.
create policy rb_all on public.receipt_batches for all to authenticated
  using (private.is_editor(organization_id)) with check (private.is_editor(organization_id));
create policy ri_all on public.receipt_items for all to authenticated
  using (private.is_editor(organization_id)) with check (private.is_editor(organization_id));

-- Statements: editors see all; an owner_viewer sees their own.
create policy os_select on public.owner_statements for select to authenticated
  using (private.is_editor(organization_id) or owner_id = private.my_owner(organization_id));
create policy os_write on public.owner_statements for all to authenticated
  using (private.is_editor(organization_id)) with check (private.is_editor(organization_id));

-- Audit log: admins read; nobody writes directly.
create policy audit_select on public.audit_log for select to authenticated
  using (private.is_admin(organization_id));

-- ---------------------------------------------------------------------------
-- Closed months are read-only
-- ---------------------------------------------------------------------------

create function private.month_is_closed(villa uuid, d date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.month_closes
    where villa_id = villa
      and month = date_trunc('month', d)::date
      and status = 'closed'
  )
$$;

create function private.guard_closed_month()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  col text := case when tg_table_name = 'stays' then 'check_in' else 'date' end;
  old_d date;
  new_d date;
begin
  -- Set only by back-office jobs (e.g. deleting an organization on request).
  if current_setting('app.bypass_close_guard', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    old_d := (to_jsonb(old) ->> col)::date;
    if private.month_is_closed(old.villa_id, old_d) then
      raise exception 'Month % is closed for this villa; record an adjustment in an open month instead',
        to_char(old_d, 'YYYY-MM') using errcode = 'check_violation';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new_d := (to_jsonb(new) ->> col)::date;
    if private.month_is_closed(new.villa_id, new_d) then
      raise exception 'Month % is closed for this villa; record an adjustment in an open month instead',
        to_char(new_d, 'YYYY-MM') using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_closed_month
  before insert or update or delete on public.transactions
  for each row execute function private.guard_closed_month();

create trigger guard_closed_month
  before insert or update or delete on public.stays
  for each row execute function private.guard_closed_month();

-- ---------------------------------------------------------------------------
-- Audit trigger
-- ---------------------------------------------------------------------------

create function private.audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (organization_id, table_name, row_id, action, actor, old_row, new_row)
  values (
    (r ->> 'organization_id')::uuid,
    tg_table_name,
    (r ->> 'id')::uuid,
    tg_op,
    auth.uid(),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger audit after insert or update or delete on public.transactions
  for each row execute function private.audit();
create trigger audit after insert or update or delete on public.stays
  for each row execute function private.audit();
create trigger audit after insert or update or delete on public.month_closes
  for each row execute function private.audit();
create trigger audit after insert or update or delete on public.villa_ownerships
  for each row execute function private.audit();
create trigger audit after insert or update or delete on public.memberships
  for each row execute function private.audit();

-- ---------------------------------------------------------------------------
-- Onboarding: create an organization with the caller as admin
-- ---------------------------------------------------------------------------

create function public.create_organization(org_name text, reporting_currency char(3) default 'USD')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  org uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  insert into public.organizations (name, reporting_currency)
  values (org_name, reporting_currency)
  returning id into org;

  insert into public.memberships (organization_id, user_id, role)
  values (org, auth.uid(), 'admin');

  insert into public.categories (organization_id, kind, name)
  select org, k::public.category_kind, n
  from (values
    ('income',  'Accommodation'),
    ('income',  'Extra services'),
    ('income',  'Other income'),
    ('expense', 'Staff'),
    ('expense', 'Utilities'),
    ('expense', 'Internet & TV'),
    ('expense', 'Cleaning & laundry'),
    ('expense', 'Guest supplies'),
    ('expense', 'Maintenance & repairs'),
    ('expense', 'Pool & garden'),
    ('expense', 'Furniture & equipment'),
    ('expense', 'Management fees'),
    ('expense', 'Taxes & licences'),
    ('expense', 'Insurance'),
    ('expense', 'Bank fees'),
    ('expense', 'Other expenses')
  ) as d(k, n);

  return org;
end;
$$;

revoke execute on function public.create_organization(text, char) from public, anon;
grant execute on function public.create_organization(text, char) to authenticated;

-- ---------------------------------------------------------------------------
-- Views (run with the caller's rights, so RLS applies)
-- ---------------------------------------------------------------------------

-- Validated expenses at or above the organization's threshold with no evidence attached.
create view public.expenses_missing_evidence
with (security_invoker = true) as
select t.*
from public.transactions t
join public.organizations o on o.id = t.organization_id
where t.direction = 'out'
  and t.status = 'validated'
  and t.amount_reporting >= o.evidence_threshold
  and not exists (select 1 from public.evidence e where e.transaction_id = t.id);

-- Monthly totals per villa, in the reporting currency.
create view public.villa_month_totals
with (security_invoker = true) as
select
  t.organization_id,
  t.villa_id,
  date_trunc('month', t.date)::date as month,
  sum(t.amount_reporting) filter (where t.direction = 'in')  as income,
  sum(t.amount_reporting) filter (where t.direction = 'out') as expenses,
  coalesce(sum(t.amount_reporting) filter (where t.direction = 'in'), 0)
    - coalesce(sum(t.amount_reporting) filter (where t.direction = 'out'), 0) as net
from public.transactions t
where t.status = 'validated'
group by 1, 2, 3;
