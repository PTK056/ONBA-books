-- Sply Accountant (migration bank_accountant): proposals are admins only, one open per line, decided once, out of
-- date when their line is handled some other way; a pass counts against the bank_review allowance.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin-a@test.local'),
  ('00000000-0000-0000-0000-0000000000a1', 'staff-a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'admin-b@test.local');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u::text, true);
$$;
create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;
create function pg_temp.fails(stmt text, code text, what text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAILED: % (no error)', what;
exception when others then
  if sqlerrm like 'FAILED:%' then raise; end if;
  if sqlerrm not like code || '%' then raise exception 'FAILED: % (got: %)', what, sqlerrm; end if;
  raise notice 'ok - %', what;
end $$;
create function pg_temp.id(key text) returns uuid language sql as $$ select v from ids where k = key $$;
create function pg_temp.line(fp text, amt numeric) returns uuid language sql as $$
  insert into bank_lines (organization_id, account_id, statement_id, date, direction, amount, currency, description, fingerprint)
  values (pg_temp.id('org'), pg_temp.id('acct'), pg_temp.id('stmt'), '2026-10-03', 'out', amt, 'IDR', 'TRF ' || fp, fp) returning id;
$$;
create function pg_temp.propose(line uuid, act text default 'add') returns uuid language sql as $$
  select public.bank_proposal_add(pg_temp.id('run'), jsonb_build_object(
    'line_id', line, 'action', act, 'villa_id', pg_temp.id('villa'),
    'category_id', (select id from categories where organization_id = pg_temp.id('org') and kind = 'expense' limit 1),
    'confidence', 'high', 'why', 'Like last time', 'question', case when act = 'ask' then 'What is it?' end));
$$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into ids select 'org', public.create_organization('Org A', 'IDR');
insert into memberships (organization_id, user_id, role) values (pg_temp.id('org'), '00000000-0000-0000-0000-0000000000a1', 'staff');
with v as (insert into villas (organization_id, name, currency) values (pg_temp.id('org'), 'Villa', 'IDR') returning id)
insert into ids select 'villa', id from v;
with a as (insert into bank_accounts (organization_id, name, institution, currency, last4)
  values (pg_temp.id('org'), 'Danamon', 'danamon', 'IDR', '4821') returning id)
insert into ids select 'acct', id from a;
with s as (insert into bank_statements (organization_id, account_id, storage_path, mime_type)
  values (pg_temp.id('org'), pg_temp.id('acct'), pg_temp.id('org') || '/s.pdf', 'application/pdf') returning id)
insert into ids select 'stmt', id from s;
insert into ids select 'run', public.bank_run_start(pg_temp.id('org'), null, 'app', 2, 'm');
select pg_temp.expect((select started_by = '00000000-0000-0000-0000-00000000000a' from bank_accountant_runs), 'a pass records who started it');
select pg_temp.fails(format('select public.bank_run_start(%L, null, %L, 1, null)', pg_temp.id('org'), 'app'), 'busy', 'one pass at a time');
select pg_temp.fails(format($q$insert into bank_accountant_runs (organization_id, trigger) values (%L, 'app')$q$, pg_temp.id('org')),
  'permission denied', 'passes are never written directly');

insert into ids values ('l1', pg_temp.line('fp1', 350000)), ('l2', pg_temp.line('fp2', 100000));
insert into ids values ('p1', pg_temp.propose(pg_temp.id('l1')));
select pg_temp.expect((select pg_temp.propose(pg_temp.id('l1'))) is null, 'a line has one open proposal at most');
select pg_temp.fails(format($q$select public.bank_proposal_add(%L, jsonb_build_object('line_id', %L::text, 'action', 'ask', 'confidence', 'low', 'why', 'w'))$q$,
  pg_temp.id('run'), pg_temp.id('l2')), 'new row', 'a question needs its question');
select pg_temp.fails(format($q$update bank_proposals set telegram = '[{"chat":"1","message":1}]' where id = %L$q$, pg_temp.id('p1')),
  'permission denied', 'no one rewrites a proposal (its Telegram messages, its status) directly');

-- Decided once: the first click wins, the second is told.
select pg_temp.expect((select (public.bank_proposal_claim(pg_temp.id('p1'), 'accepted')).status = 'accepted'), 'a proposal is claimed for a decision');
select pg_temp.expect((select decided_by = '00000000-0000-0000-0000-00000000000a' and decided_at is not null from bank_proposals where id = pg_temp.id('p1')),
  'and records who decided');
select pg_temp.fails(format('select public.bank_proposal_claim(%L, %L)', pg_temp.id('p1'), 'rejected'), 'already_handled', 'a decided proposal cannot be decided again');
select pg_temp.fails(format('select public.bank_proposal_claim(%L, %L)', pg_temp.id('p1'), 'applied'), 'Unknown decision', 'only accept or reject');
select public.bank_proposal_finish(pg_temp.id('p1'), 'applied', 'Added to the books.');
select pg_temp.expect((select status = 'applied' and outcome = 'Added to the books.' from bank_proposals where id = pg_temp.id('p1')), 'its decider records the outcome');
select public.bank_proposal_finish(pg_temp.id('p1'), 'failed', 'again');
select pg_temp.expect((select status from bank_proposals where id = pg_temp.id('p1')) = 'applied', 'only once');

-- A line handled some other way makes its open proposal out of date.
insert into ids values ('p2', pg_temp.propose(pg_temp.id('l2')));
select public.bank_line_personal(pg_temp.id('l2'), 'owner_transfer', 'app');
select pg_temp.expect((select status from bank_proposals where id = pg_temp.id('p2')) = 'stale', 'handling the line elsewhere makes its proposal stale');
select pg_temp.fails(format('select public.bank_proposal_claim(%L, %L)', pg_temp.id('p2'), 'accepted'), 'already_handled', 'a stale proposal cannot be accepted');
select pg_temp.expect((select pg_temp.propose(pg_temp.id('l2'))) is null, 'a line handled meanwhile gets no proposal');
select public.bank_line_reset(pg_temp.id('l2'));
insert into ids values ('p3', pg_temp.propose(pg_temp.id('l2'), 'ask'));
select pg_temp.expect((select pg_temp.id('p3')) is not null, 'once back in the list, the line can get a new proposal');

-- An accepted proposal whose application never finished can be decided again after the lease.
insert into ids values ('l3', pg_temp.line('fp3', 5000));
insert into ids values ('p4', pg_temp.propose(pg_temp.id('l3')));
select public.bank_proposal_claim(pg_temp.id('p4'), 'accepted');
select pg_temp.fails(format('select public.bank_proposal_claim(%L, %L)', pg_temp.id('p4'), 'accepted'), 'already_handled', 'not at once');
reset role;
update bank_proposals set decided_at = now() - interval '11 minutes' where id = pg_temp.id('p4');
set local role authenticated;
select pg_temp.expect((select (public.bank_proposal_claim(pg_temp.id('p4'), 'rejected')).status = 'rejected'), 'but after the lease, yes');

select public.bank_run_finish(pg_temp.id('run'), 3, null, 10, 5);
select pg_temp.expect((select finished_at is not null and proposals = 3 from bank_accountant_runs where id = pg_temp.id('run')), 'a pass is finished');

-- The allowance.
select pg_temp.expect((select public.ai_take(pg_temp.id('org'), 'bank_review', 40)) = 30, 'Sply Accountant passes: 30 a month by default');
select pg_temp.expect((select quota from public.ai_quota(pg_temp.id('org')) where kind = 'bank_review') = 30, 'and the quota shows it');

-- A statement's charges are decided together.
insert into ids select 'run2', public.bank_run_start(pg_temp.id('org'), pg_temp.id('stmt'), 'statement', 2, null);
insert into ids values ('c1', pg_temp.line('fp-c1', 7500)), ('c2', pg_temp.line('fp-c2', 2500));
insert into ids select 'pc' || n, public.bank_proposal_add(pg_temp.id('run2'), jsonb_build_object('line_id', pg_temp.id('c' || n), 'action', 'charges',
  'statement_id', pg_temp.id('stmt'), 'confidence', 'high', 'why', 'Bank fees')) from generate_series(1, 2) n;
select public.bank_proposal_group(pg_temp.id('pc1'), 'rejected');
select pg_temp.expect((select status from bank_proposals where id = pg_temp.id('pc2')) = 'pending', 'a group decision needs the proposal decided first');
select public.bank_proposal_claim(pg_temp.id('pc1'), 'rejected');
select public.bank_proposal_group(pg_temp.id('pc1'), 'rejected');
select pg_temp.expect((select status from bank_proposals where id = pg_temp.id('pc2')) = 'rejected', 'declining a statement''s charges declines them all');

-- Telegram messages and chat notes: the server only.
select pg_temp.fails(format('select public.bank_proposal_telegram(%L, %L, %L, 1)', pg_temp.id('pc1'), pg_temp.id('org'), '42'),
  'permission denied', 'a user cannot point a proposal at a Telegram chat');
select pg_temp.fails('select public.chat_notes_take(gen_random_uuid())', 'permission denied', 'a user cannot read chat notes');
set local role service_role;
insert into channel_links (id, user_id, channel, external_id, refresh_token_enc)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'telegram', '42', 'x');
select public.chat_notes_add('00000000-0000-0000-0000-0000000000c1', '[{"n":1},{"n":2}]');
select public.chat_notes_add('00000000-0000-0000-0000-0000000000c1', '[{"n":3}]');
select pg_temp.expect((select public.chat_notes_take('00000000-0000-0000-0000-0000000000c1')) = '[{"n":1},{"n":2},{"n":3}]'::jsonb,
  'notes add up and are taken in order');
select pg_temp.expect((select notes = '[]'::jsonb from chat_conversations where link_id = '00000000-0000-0000-0000-0000000000c1'), 'and taken once');
select public.bank_proposal_telegram(pg_temp.id('pc1'), pg_temp.id('org'), '42', 7);
select pg_temp.expect((select telegram = '[{"chat":"42","message":7}]'::jsonb from bank_proposals where id = pg_temp.id('pc1')), 'the server remembers the message');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');

-- A member's date is when they were added, whatever the adder says.
insert into memberships (organization_id, user_id, role, created_at)
values (pg_temp.id('org'), '00000000-0000-0000-0000-00000000000b', 'staff', '2020-01-01');
select pg_temp.expect((select created_at > now() - interval '1 minute' from memberships
  where user_id = '00000000-0000-0000-0000-00000000000b' and organization_id = pg_temp.id('org')), 'a membership cannot be backdated');
delete from memberships where user_id = '00000000-0000-0000-0000-00000000000b' and organization_id = pg_temp.id('org');

-- Who may.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect((select count(*) from bank_proposals) + (select count(*) from bank_accountant_runs) = 0, 'staff sees no proposal and no pass');
select pg_temp.fails(format('select public.bank_proposal_claim(%L, %L)', pg_temp.id('p3'), 'rejected'), 'already_handled', 'staff cannot decide a proposal');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from bank_proposals) = 0, 'another organization sees none');
select pg_temp.fails(format('select public.bank_proposal_claim(%L, %L)', pg_temp.id('p3'), 'rejected'), 'already_handled', 'nor decides one');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select status from bank_proposals where id = pg_temp.id('p3')) = 'pending', 'and it is still open for its admin');

rollback;
