-- Splyce — Sply Performance (docs/module-sply-performance.md): once a month is closed, the figures of each villa
-- compared with history and with the owner's goals, and at most three actions for the month ahead.
-- The figures are computed by the app (lib/performance); Claude only writes the diagnosis and the actions.
--
--   villa_blocks         nights a villa could not be sold: the owner's own stays, works. Occupancy leaves them out.
--   performance_goals    where the owner wants the books to be by a date (e.g. break even by the end of the lease).
--   performance_reports  one per organization and closed month: the figures as they were, and what Sply made of them.
--   performance_actions  the actions of a report; one tap makes one a Splyce task.
--
-- Goals, reports and actions are admins only (the whole result of the business). Blocks are calendar data: seen by
-- whoever sees the villa (an owner only theirs), written by staff and admins.

-- ---------------------------------------------------------------------------
-- Blocked nights
-- ---------------------------------------------------------------------------

create table public.villa_blocks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  villa_id         uuid not null,
  starts_on        date not null,               -- first night blocked
  ends_on          date not null,               -- the morning it ends, as a stay's check-out
  reason           text not null default 'owner' check (reason in ('owner', 'works', 'other')),
  note             text check (note is null or length(note) <= 200),
  created_by       uuid default auth.uid() references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  foreign key (villa_id, organization_id) references public.villas(id, organization_id) on delete cascade,
  check (ends_on > starts_on),
  check (ends_on - starts_on <= 366)
);

create index on public.villa_blocks (organization_id, starts_on);

alter table public.villa_blocks enable row level security;
create policy villa_block_select on public.villa_blocks for select to authenticated
  using (private.can_see_villa(villa_id));
create policy villa_block_write on public.villa_blocks for all to authenticated
  using (private.is_editor(organization_id)) with check (private.is_editor(organization_id));
create trigger audit after insert or update or delete on public.villa_blocks
  for each row execute function private.audit();

-- ---------------------------------------------------------------------------
-- Goals: the cumulative result (income − expenses, every validated entry) to reach by a date.
-- ---------------------------------------------------------------------------

create table public.performance_goals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  villa_id         uuid,                        -- null: the whole organization (villas and company)
  label            text not null check (length(trim(label)) between 1 and 80),
  since            date not null,               -- the result is counted from this day
  by_date          date not null,
  target           numeric(18,2) not null default 0,   -- in the reporting currency; 0 = break even
  invested         numeric(18,2) check (invested is null or invested > 0),   -- capital at stake, for the ROI
  -- Money still to put in before by_date that is not in the books yet (e.g. a lease year to renew).
  planned          numeric(18,2) not null default 0 check (planned >= 0),
  planned_note     text check (planned_note is null or length(planned_note) <= 200),
  archived_at      timestamptz,
  created_by       uuid default auth.uid() references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  foreign key (villa_id, organization_id) references public.villas(id, organization_id) on delete cascade,
  check (by_date > since)
);

create index on public.performance_goals (organization_id) where archived_at is null;

alter table public.performance_goals enable row level security;
create policy performance_goal_admin on public.performance_goals for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));
create trigger audit after insert or update or delete on public.performance_goals
  for each row execute function private.audit();

-- ---------------------------------------------------------------------------
-- Reports and their actions
-- ---------------------------------------------------------------------------

create table public.performance_reports (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  month            date not null check (month = date_trunc('month', month)::date),
  status           text not null check (status in ('running', 'ready', 'failed')),
  facts            jsonb not null default '{}',   -- the figures given to Claude, as they were (lib/performance)
  analysis         jsonb,                         -- headline, wins, issues, goals comment
  engine           integer not null,              -- version of the figures' code
  model            text,
  input_tokens     integer,
  output_tokens    integer,
  error            text,
  created_by       uuid default auth.uid() references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, month),
  unique (id, organization_id)
);

alter table public.performance_reports enable row level security;
create policy performance_report_admin on public.performance_reports for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));
create trigger audit after insert or update or delete on public.performance_reports
  for each row execute function private.audit();

-- Claims a month's report for writing: one writer at a time (two closes in a row, the app and Telegram). Null when
-- it is being written already (a writer that died is taken over after 10 minutes). Admins only.
create function public.performance_report_claim(p_org uuid, p_month date)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_admin(p_org) then
    raise exception 'not_admin: only admins write reports' using errcode = 'insufficient_privilege';
  end if;
  insert into public.performance_reports as r (organization_id, month, status, engine)
  values (p_org, p_month, 'running', 0)
  on conflict (organization_id, month) do update set status = 'running', updated_at = now(), error = null
    where r.status <> 'running' or r.updated_at < now() - interval '10 minutes'
  returning r.id into v_id;
  return v_id;
end $$;

revoke execute on function public.performance_report_claim(uuid, date) from public, anon;
grant execute on function public.performance_report_claim(uuid, date) to authenticated;

-- An action's task is a task of the same organization.
alter table public.tasks add constraint tasks_id_organization_key unique (id, organization_id);

create table public.performance_actions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  report_id        uuid not null,
  position         smallint not null check (position between 1 and 30),  -- 1–3 per writing; a rewrite adds after those decided
  villa_id         uuid,
  title            text not null check (length(trim(title)) between 1 and 120),
  why              text not null check (length(why) <= 600),
  metrics          text[] not null default '{}',  -- the figures it rests on (keys of the report's facts)
  impact           numeric(18,2),                 -- estimated, reporting currency, per month
  impact_note      text check (impact_note is null or length(impact_note) <= 300),
  effort           text not null check (effort in ('low', 'medium', 'high')),
  due_on           date,
  status           text not null default 'proposed' check (status in ('proposed', 'accepted', 'dismissed')),
  task_id          uuid,
  decided_by       uuid references auth.users(id) on delete set null,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  foreign key (report_id, organization_id) references public.performance_reports(id, organization_id) on delete cascade,
  foreign key (villa_id, organization_id) references public.villas(id, organization_id) on delete set null (villa_id),
  foreign key (task_id, organization_id) references public.tasks(id, organization_id) on delete set null (task_id),
  check ((status = 'proposed') = (decided_at is null))
);

create index on public.performance_actions (report_id);

alter table public.performance_actions enable row level security;
create policy performance_action_admin on public.performance_actions for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));
create trigger audit after insert or update or delete on public.performance_actions
  for each row execute function private.audit();

-- An action becomes a Splyce task, once: a second tap (app and Telegram) gives the same task. Admins only (RLS).
create function public.performance_action_accept(p_action uuid)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  a public.performance_actions;
  v_task uuid;
begin
  select * into a from public.performance_actions where id = p_action for update;
  if not found then
    raise exception 'not_found: unknown action' using errcode = 'no_data_found';
  end if;
  if a.task_id is not null then
    return a.task_id;
  end if;
  insert into public.tasks (organization_id, villa_id, kind, title, notes, due_date)
  values (a.organization_id, a.villa_id, 'todo', left(a.title, 200),
          left(concat_ws(E'\n', a.why, case when a.impact is not null or a.impact_note is not null
            then 'Expected: ' || coalesce(a.impact_note, '') end, '— Sply Performance'), 1000),
          a.due_on)
  returning id into v_task;
  update public.performance_actions
     set status = 'accepted', task_id = v_task, decided_by = auth.uid(), decided_at = now()
   where id = a.id;
  return v_task;
end $$;

revoke execute on function public.performance_action_accept(uuid) from public, anon;
grant execute on function public.performance_action_accept(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- AI quota: one report written by Claude counts as one 'performance' (default 10 a month).
-- ---------------------------------------------------------------------------

alter table private.ai_usage drop constraint ai_usage_kind_check;
alter table private.ai_usage add constraint ai_usage_kind_check
  check (kind in ('receipt', 'agent_message', 'voice_minute', 'bank_statement', 'bank_review', 'performance'));
alter table private.ai_limits add column performance integer check (performance >= 0);

create or replace function private.ai_limit(org uuid, k text)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select case k when 'receipt' then l.receipt when 'agent_message' then l.agent_message
                   when 'voice_minute' then l.voice_minute when 'bank_statement' then l.bank_statement
                   when 'bank_review' then l.bank_review else l.performance end
     from private.ai_limits l where l.organization_id = org),
    case k when 'receipt' then 100 when 'agent_message' then 300 when 'voice_minute' then 60 when 'bank_statement' then 20
           when 'bank_review' then 30 else 10 end)
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
  if k not in ('receipt', 'agent_message', 'voice_minute', 'bank_statement', 'bank_review', 'performance') then
    raise exception 'Unknown quota %', k;
  end if;
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
  from unnest(array['receipt', 'agent_message', 'voice_minute', 'bank_statement', 'bank_review', 'performance']) k
  left join private.ai_usage u on u.organization_id = org and u.month = private.ai_month(org) and u.kind = k
  where private.is_member(org)
$$;
