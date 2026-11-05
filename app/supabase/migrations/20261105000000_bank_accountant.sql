-- Splyce — Sply Accountant (docs/module-sply-accountant.md): after a statement, Sply proposes what each line left
-- to do is; the owner accepts or declines (Bank tab, Telegram buttons); accepting runs the bank actions of migration
-- bank_agent, never the AI. Admins only, like the rest of the bank module.
--
-- Users read proposals and passes; they never write them directly (the columns include the Telegram messages the
-- bot edits): every write goes through the functions below, which check the caller is an admin of the organization.

-- One pass of Sply over some lines: what it was asked, what it proposed, what it cost.
create table public.bank_accountant_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  statement_id     uuid,
  trigger          text not null check (trigger in ('statement', 'app', 'chat')),
  lines            integer not null default 0,
  proposals        integer not null default 0,
  model            text,
  input_tokens     integer,
  output_tokens    integer,
  error            text check (char_length(error) <= 500),
  started_by       uuid references auth.users(id) on delete set null default auth.uid(),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  foreign key (statement_id, organization_id) references public.bank_statements(id, organization_id) on delete set null (statement_id),
  unique (id, organization_id)
);
create index on public.bank_accountant_runs (organization_id, started_at desc);

-- What Sply proposes for one line. At most one open (pending) proposal per line.
create table public.bank_proposals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  run_id           uuid not null,
  line_id          uuid not null,
  action           text not null check (action in ('add', 'link', 'link_stays', 'personal', 'charges', 'ask')),
  villa_id         uuid,
  category_id      uuid,
  description      text check (char_length(description) <= 300),
  transaction_id   uuid,
  stay_ids         uuid[],
  personal_reason  text check (personal_reason in ('owner_transfer', 'owner_contribution', 'private_expense', 'internal_transfer')),
  statement_id     uuid,                                   -- action charges: the statement whose charges are booked
  amount_differs   boolean not null default false,         -- link: the entry's amount is not the line's (the user agrees by accepting)
  fx_rate          numeric(20,10) check (fx_rate > 0),     -- add, line not in the reporting currency: the rate shown and used
  confidence       text not null check (confidence in ('high', 'medium', 'low')),
  why              text not null check (char_length(why) <= 400),
  question         text check (char_length(question) <= 400),
  status           text not null default 'pending' check (status in ('pending', 'accepted', 'applied', 'rejected', 'stale', 'failed')),
  outcome          text check (char_length(outcome) <= 400),
  -- Telegram messages showing it, to update them once decided: [{ "chat": "123", "message": 45 }]
  telegram         jsonb not null default '[]',
  decided_by       uuid references auth.users(id) on delete set null,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  foreign key (run_id, organization_id)  references public.bank_accountant_runs(id, organization_id) on delete cascade,
  foreign key (line_id, organization_id) references public.bank_lines(id, organization_id) on delete cascade,
  foreign key (villa_id, organization_id)    references public.villas(id, organization_id) on delete set null (villa_id),
  foreign key (category_id, organization_id) references public.categories(id, organization_id) on delete set null (category_id),
  foreign key (transaction_id, organization_id) references public.transactions(id, organization_id) on delete set null (transaction_id),
  foreign key (statement_id, organization_id) references public.bank_statements(id, organization_id) on delete cascade,
  check (action <> 'ask' or question is not null),
  check (action <> 'add' or villa_id is not null),
  check (action <> 'link' or transaction_id is not null or status <> 'pending'),
  check (action <> 'link_stays' or cardinality(stay_ids) between 1 and 20),
  check (action <> 'personal' or personal_reason is not null),
  check (action <> 'charges' or statement_id is not null),
  -- Decided ones say when; a pending one is undecided; a stale one may be either (its line was handled elsewhere).
  check (status = 'stale' or (status = 'pending') = (decided_at is null))
);
create unique index bank_proposals_one_open on public.bank_proposals (line_id) where status = 'pending';
create index on public.bank_proposals (organization_id, status, created_at desc);
create index on public.bank_proposals (run_id);

alter table public.bank_accountant_runs enable row level security;
alter table public.bank_proposals       enable row level security;
create policy bank_accountant_runs_read on public.bank_accountant_runs for select to authenticated
  using (private.is_admin(organization_id));
create policy bank_proposals_read on public.bank_proposals for select to authenticated
  using (private.is_admin(organization_id));
revoke insert, update, delete on public.bank_accountant_runs, public.bank_proposals from authenticated, anon;

-- An accepted proposal whose application never finished (the server stopped) can be decided again after this long.
create function private.bank_proposal_lease() returns interval language sql immutable as $$ select interval '10 minutes' $$;

-- A proposal whose line was handled some other way (in the app, by Match again, by the assistant) is out of date.
create function private.bank_proposal_stale() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'unmatched' and old.status = 'unmatched' then
    update public.bank_proposals set status = 'stale'
    where line_id = new.id
      and (status = 'pending' or (status = 'accepted' and decided_at < now() - private.bank_proposal_lease()));
  end if;
  return null;
end $$;
create trigger bank_proposal_stale after update of status on public.bank_lines
  for each row execute function private.bank_proposal_stale();

-- Claims a pending proposal for a decision: only the first click (app or Telegram) gets it. An accepted one whose
-- application never finished can be claimed again after the lease.
create function public.bank_proposal_claim(p_proposal uuid, p_status text)
returns public.bank_proposals
language plpgsql security definer set search_path = '' as $$
declare
  p public.bank_proposals;
begin
  if p_status not in ('accepted', 'rejected') then raise exception 'Unknown decision %', p_status; end if;
  update public.bank_proposals set status = p_status, decided_by = auth.uid(), decided_at = now()
  where id = p_proposal and private.is_admin(organization_id)
    and (status = 'pending' or (status = 'accepted' and decided_at < now() - private.bank_proposal_lease()))
  returning * into p;
  if p.id is null then
    raise exception 'already_handled: This proposal was already decided, or its line handled.';
  end if;
  return p;
end $$;

-- Records how an accepted proposal ended. Only its decider can, and only once.
create function public.bank_proposal_finish(p_proposal uuid, p_status text, p_outcome text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('applied', 'failed', 'stale') then raise exception 'Unknown outcome %', p_status; end if;
  update public.bank_proposals set status = p_status, outcome = left(p_outcome, 400)
  where id = p_proposal and status = 'accepted' and decided_by = auth.uid() and private.is_admin(organization_id);
end $$;

-- Starts a pass. One at a time per organization: a pass started in the last five minutes and not finished blocks it.
create function public.bank_run_start(p_org uuid, p_statement uuid, p_trigger text, p_lines integer, p_model text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  id uuid;
begin
  if not private.is_admin(p_org) then raise exception 'not_found: No such organization.'; end if;
  perform 1 from public.organizations where organizations.id = p_org for update;  -- serializes two starts
  if exists (select 1 from public.bank_accountant_runs r where r.organization_id = p_org and r.finished_at is null
             and r.started_at > now() - interval '5 minutes') then
    raise exception 'busy: Sply Accountant is already going through your bank lines.';
  end if;
  insert into public.bank_accountant_runs (organization_id, statement_id, trigger, lines, model)
  values (p_org, p_statement, p_trigger, p_lines, p_model) returning bank_accountant_runs.id into id;
  return id;
end $$;

create function public.bank_run_finish(p_run uuid, p_proposals integer, p_error text, p_input integer, p_output integer)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.bank_accountant_runs set proposals = p_proposals, error = left(p_error, 500), input_tokens = p_input,
    output_tokens = p_output, finished_at = now()
  where id = p_run and private.is_admin(organization_id) and finished_at is null;
end $$;

-- Adds one proposal to a pass. The line is locked and must still be to do in the same organization: a line handled
-- while Sply was thinking gets no proposal (null). Names and ids are checked by the foreign keys (same organization).
create function public.bank_proposal_add(p_run uuid, p jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  org  uuid;
  st   public.bank_line_status;
  id   uuid;
begin
  select r.organization_id into org from public.bank_accountant_runs r where r.id = p_run and r.finished_at is null;
  if org is null or not private.is_admin(org) then raise exception 'not_found: No such pass.'; end if;
  select l.status into st from public.bank_lines l where l.id = (p->>'line_id')::uuid and l.organization_id = org for share;
  if st is distinct from 'unmatched' then return null; end if;
  insert into public.bank_proposals (organization_id, run_id, line_id, action, villa_id, category_id, description,
    transaction_id, stay_ids, personal_reason, statement_id, amount_differs, fx_rate, confidence, why, question)
  values (org, p_run, (p->>'line_id')::uuid, p->>'action', nullif(p->>'villa_id', '')::uuid, nullif(p->>'category_id', '')::uuid,
    p->>'description', nullif(p->>'transaction_id', '')::uuid,
    case when jsonb_typeof(p->'stay_ids') = 'array' then array(select jsonb_array_elements_text(p->'stay_ids')::uuid) end,
    p->>'personal_reason', nullif(p->>'statement_id', '')::uuid, coalesce((p->>'amount_differs')::boolean, false),
    nullif(p->>'fx_rate', '')::numeric, p->>'confidence', p->>'why', p->>'question')
  on conflict (line_id) where status = 'pending' do nothing
  returning bank_proposals.id into id;
  return id;
end $$;

-- A decision on a statement's bank charges counts for all of that statement's charge proposals of the pass.
create function public.bank_proposal_group(p_proposal uuid, p_status text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.bank_proposals;
begin
  if p_status not in ('applied', 'rejected') then raise exception 'Unknown outcome %', p_status; end if;
  -- Only after its decider decided the proposal itself the same way.
  select * into p from public.bank_proposals where id = p_proposal and action = 'charges' and decided_by = auth.uid()
    and status = case p_status when 'rejected' then 'rejected' else 'accepted' end;
  if p.id is null or not private.is_admin(p.organization_id) then return; end if;
  update public.bank_proposals set status = p_status, decided_by = auth.uid(), decided_at = now()
  where run_id = p.run_id and statement_id = p.statement_id and action = 'charges' and id <> p.id and status in ('pending', 'stale');
end $$;

-- Remembers a Telegram message showing a proposal, to update it once decided. Server only: the bot edits these.
create function public.bank_proposal_telegram(p_proposal uuid, p_org uuid, p_chat text, p_message bigint)
returns void
language sql security definer set search_path = '' as $$
  update public.bank_proposals set telegram = telegram || jsonb_build_array(jsonb_build_object('chat', p_chat, 'message', p_message))
  where id = p_proposal and organization_id = p_org;
$$;
revoke execute on function public.bank_proposal_telegram(uuid, uuid, text, bigint) from public, anon, authenticated;

revoke execute on function public.bank_proposal_claim(uuid, text) from public, anon;
revoke execute on function public.bank_proposal_finish(uuid, text, text) from public, anon;
revoke execute on function public.bank_run_start(uuid, uuid, text, integer, text) from public, anon;
revoke execute on function public.bank_run_finish(uuid, integer, text, integer, integer) from public, anon;
revoke execute on function public.bank_proposal_add(uuid, jsonb) from public, anon;
revoke execute on function public.bank_proposal_group(uuid, text) from public, anon;
grant execute on function public.bank_proposal_claim(uuid, text) to authenticated;
grant execute on function public.bank_proposal_finish(uuid, text, text) to authenticated;
grant execute on function public.bank_run_start(uuid, uuid, text, integer, text) to authenticated;
grant execute on function public.bank_run_finish(uuid, integer, text, integer, integer) to authenticated;
grant execute on function public.bank_proposal_add(uuid, jsonb) to authenticated;
grant execute on function public.bank_proposal_group(uuid, text) to authenticated;

-- Notes for the chat assistant: what Sply Accountant asked in the chat, so a reply ("raja niaga is the gas supplier")
-- reaches the assistant with the line it is about. Shown on the next turn, then cleared.
alter table public.chat_conversations add column notes jsonb not null default '[]';

-- Appends notes (the last 20 kept) / takes them all at once: two writers never lose each other's. Server only.
create function public.chat_notes_add(p_link uuid, p_notes jsonb)
returns void
language sql security definer set search_path = '' as $$
  insert into public.chat_conversations (link_id, notes) values (p_link, p_notes)
  on conflict (link_id) do update set notes = (
    select coalesce(jsonb_agg(n order by i), '[]'::jsonb) from (
      select n, i from jsonb_array_elements(public.chat_conversations.notes || excluded.notes) with ordinality as x(n, i)
      order by i desc limit 20) last);
$$;
create function public.chat_notes_take(p_link uuid)
returns jsonb
language sql security definer set search_path = '' as $$
  with old as (select notes from public.chat_conversations where link_id = p_link for update)
  update public.chat_conversations c set notes = '[]' from old where c.link_id = p_link returning old.notes;
$$;
revoke execute on function public.chat_notes_add(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.chat_notes_take(uuid) from public, anon, authenticated;

-- AI quota: one pass of Sply over a statement counts as one 'bank_review' (default 30 a month).
alter table private.ai_usage drop constraint ai_usage_kind_check;
alter table private.ai_usage add constraint ai_usage_kind_check
  check (kind in ('receipt', 'agent_message', 'voice_minute', 'bank_statement', 'bank_review'));
alter table private.ai_limits add column bank_review integer check (bank_review >= 0);

create or replace function private.ai_limit(org uuid, k text)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select case k when 'receipt' then l.receipt when 'agent_message' then l.agent_message
                   when 'voice_minute' then l.voice_minute when 'bank_statement' then l.bank_statement else l.bank_review end
     from private.ai_limits l where l.organization_id = org),
    case k when 'receipt' then 100 when 'agent_message' then 300 when 'voice_minute' then 60 when 'bank_statement' then 20 else 30 end)
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
  if k not in ('receipt', 'agent_message', 'voice_minute', 'bank_statement', 'bank_review') then raise exception 'Unknown quota %', k; end if;
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
  from unnest(array['receipt', 'agent_message', 'voice_minute', 'bank_statement', 'bank_review']) k
  left join private.ai_usage u on u.organization_id = org and u.month = private.ai_month(org) and u.kind = k
  where private.is_member(org)
$$;

-- The server (service_role) sends the Telegram messages and the chat notes. Supabase grants it new functions by
-- default; said here so it holds anywhere.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.bank_proposal_telegram(uuid, uuid, text, bigint) to service_role;
    grant execute on function public.chat_notes_add(uuid, jsonb) to service_role;
    grant execute on function public.chat_notes_take(uuid) to service_role;
  end if;
end $$;

-- The organization a chat works in is the user's first membership: its date is the moment it was made, never one
-- given by whoever adds the member (an earlier date would make their organization the one your chat works in).
create function private.membership_created_now() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := now();
  return new;
end $$;
create trigger membership_created_now before insert on public.memberships
  for each row execute function private.membership_created_now();
