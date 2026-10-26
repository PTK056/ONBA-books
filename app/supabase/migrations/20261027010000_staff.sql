-- Splyce — staff module: people, the work they did, and their monthly pay.
--
-- Each person has their own way of being paid (monthly with an optional weekly base and extras,
-- hourly, or per job). Work is logged by the organization (app or assistant); pay is computed from
-- the log, prepared as drafts on payday, and booked as an expense once paid.
-- Owner viewers see none of this: only the totals, through the expenses.

create type public.staff_kind as enum ('employee', 'freelance');
create type public.pay_mode   as enum ('monthly', 'hourly', 'per_job');
create type public.base_unit  as enum ('visits', 'hours');
create type public.pay_status as enum ('draft', 'paid');

create table public.staff (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  role             text,
  kind             public.staff_kind not null default 'employee',
  villa_id         uuid,
  pay_mode         public.pay_mode not null,
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  monthly_amount   numeric(18,2) check (monthly_amount >= 0),
  hourly_rate      numeric(18,2) check (hourly_rate >= 0),
  job_rate         numeric(18,2) check (job_rate >= 0),
  base_unit        public.base_unit,             -- monthly mode: what the weekly base counts
  base_per_week    numeric(6,2) check (base_per_week > 0),
  extra_rate       numeric(18,2) check (extra_rate >= 0), -- per visit/hour beyond the base; null = fixed ÷ base of the month
  payday           smallint not null default 25 check (payday between 1 and 28),
  category_id      uuid,                           -- expense category for their pay (default: a staff category)
  phone            text,
  notes            text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name),
  foreign key (villa_id, organization_id) references public.villas(id, organization_id) on delete set null (villa_id),
  foreign key (category_id, organization_id) references public.categories(id, organization_id),
  check (pay_mode <> 'monthly'  or monthly_amount is not null),
  check (pay_mode <> 'hourly'   or hourly_rate is not null),
  check (pay_mode <> 'per_job'  or job_rate is not null),
  check ((base_unit is null) = (base_per_week is null))
);

create table public.work_logs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  staff_id         uuid not null,
  villa_id         uuid,
  date             date not null,
  hours            numeric(5,2) check (hours > 0 and hours <= 24),
  jobs             smallint check (jobs > 0),      -- visits / jobs done that day (default 1 when no hours)
  extra_amount     numeric(18,2) check (extra_amount > 0), -- a one-off bonus or extra agreed for this day
  task             text,
  note             text,
  created_by       uuid default auth.uid() references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  foreign key (staff_id, organization_id) references public.staff(id, organization_id) on delete cascade,
  foreign key (villa_id, organization_id) references public.villas(id, organization_id) on delete set null (villa_id),
  check (hours is not null or jobs is not null or extra_amount is not null)
);
create index work_logs_month on public.work_logs (organization_id, date);

create table public.pay_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  staff_id         uuid not null,
  month            date not null check (month = date_trunc('month', month)::date),
  amount           numeric(18,2) not null check (amount >= 0),
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  breakdown        jsonb not null default '{}',     -- how the amount was computed, shown to the user
  status           public.pay_status not null default 'draft',
  transaction_id   uuid,                            -- the expense booked when paid
  paid_on          date,
  created_by       uuid default auth.uid() references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (staff_id, month),
  foreign key (staff_id, organization_id) references public.staff(id, organization_id) on delete cascade,
  foreign key (transaction_id, organization_id) references public.transactions(id, organization_id) on delete set null (transaction_id),
  check ((status = 'paid') = (paid_on is not null))
);

alter table public.staff     enable row level security;
alter table public.work_logs enable row level security;
alter table public.pay_runs  enable row level security;

-- Admins and staff users of the organization; owner viewers never see individual pay.
create policy staff_all on public.staff for all to authenticated
  using (private.is_editor(organization_id)) with check (private.is_editor(organization_id));
create policy work_logs_all on public.work_logs for all to authenticated
  using (private.is_editor(organization_id)) with check (private.is_editor(organization_id));
create policy pay_runs_all on public.pay_runs for all to authenticated
  using (private.is_editor(organization_id)) with check (private.is_editor(organization_id));

create trigger audit after insert or update or delete on public.staff
  for each row execute function private.audit();
create trigger audit after insert or update or delete on public.pay_runs
  for each row execute function private.audit();
