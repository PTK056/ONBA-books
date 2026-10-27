-- AI quotas: what each organization may spend on Pierre's AI keys per calendar month (org's timezone).
--   receipt        one receipt or document read by Claude (read-receipts)
--   agent_message  one chat turn answered by the assistant (Telegram, later WhatsApp)
--   voice_minute   one started minute of voice note transcribed (OpenAI)
-- Default limits below; a different limit per organization goes in private.ai_limits, which only the
-- service role (Pierre, SQL editor) can write. Admins can rename their organization but not raise their quota.

create table private.ai_limits (
  organization_id  uuid primary key references public.organizations(id) on delete cascade,
  receipt          integer check (receipt >= 0),        -- null = default
  agent_message    integer check (agent_message >= 0),
  voice_minute     integer check (voice_minute >= 0),
  note             text,
  updated_at       timestamptz not null default now()
);

create table private.ai_usage (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  month            date not null,
  kind             text not null check (kind in ('receipt', 'agent_message', 'voice_minute')),
  used             integer not null default 0 check (used >= 0),
  primary key (organization_id, month, kind)
);

create function private.ai_limit(org uuid, k text)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select case k when 'receipt' then l.receipt when 'agent_message' then l.agent_message else l.voice_minute end
     from private.ai_limits l where l.organization_id = org),
    case k when 'receipt' then 100 when 'agent_message' then 300 else 60 end)
$$;

create function private.ai_month(org uuid)
returns date
language sql stable security definer set search_path = ''
as $$
  select date_trunc('month', now() at time zone coalesce(
    (select o.timezone from public.organizations o where o.id = org), 'UTC'))::date
$$;

-- Takes up to `wanted` units of this month's quota and returns how many were granted (0 when used up).
-- Any member can spend (a viewer chatting with the assistant too); nobody can give units back.
create function public.ai_take(org uuid, k text, wanted integer default 1)
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
  if k not in ('receipt', 'agent_message', 'voice_minute') then raise exception 'Unknown quota %', k; end if;
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

-- This month's usage and limits, for the app to show (any member).
create function public.ai_quota(org uuid)
returns table (kind text, used integer, quota integer, month date)
language sql stable security definer set search_path = ''
as $$
  select k, coalesce(u.used, 0), private.ai_limit(org, k), private.ai_month(org)
  from unnest(array['receipt', 'agent_message', 'voice_minute']) k
  left join private.ai_usage u on u.organization_id = org and u.month = private.ai_month(org) and u.kind = k
  where private.is_member(org)
$$;

revoke all on function public.ai_take(uuid, text, integer) from public, anon;
revoke all on function public.ai_quota(uuid) from public, anon;
grant execute on function public.ai_take(uuid, text, integer) to authenticated;
grant execute on function public.ai_quota(uuid) to authenticated;

-- Each organization comes with its own quota, so cap how many one account can create.
create or replace function public.create_organization(org_name text, reporting_currency char(3) default 'USD')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  org uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from public.memberships m where m.user_id = auth.uid() and m.role = 'admin') >= 3 then
    raise exception 'Too many organizations for one account' using errcode = 'insufficient_privilege';
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
    ('expense', 'Platform fees'),
    ('expense', 'Taxes & licences'),
    ('expense', 'Insurance'),
    ('expense', 'Bank fees'),
    ('expense', 'Other expenses')
  ) as d(k, n);

  return org;
end;
$$;
