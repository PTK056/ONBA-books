-- Sply Performance (migration performance): goals, reports and actions are admins only; blocked nights are written by
-- staff and admins; an action becomes one task, once; a report counts against the 'performance' allowance.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin-a@test.local'),
  ('00000000-0000-0000-0000-0000000000a1', 'staff-a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'admin-b@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'owner-two@test.local');

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

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into ids select 'org', public.create_organization('Org A', 'IDR');
insert into memberships (organization_id, user_id, role) values (pg_temp.id('org'), '00000000-0000-0000-0000-0000000000a1', 'staff');
with v as (insert into villas (organization_id, name, currency) values (pg_temp.id('org'), 'Villa', 'IDR') returning id)
insert into ids select 'villa', id from v;

-- Goals: admins.
with g as (insert into performance_goals (organization_id, label, since, by_date, invested, planned, planned_note)
  values (pg_temp.id('org'), 'Break even', '2024-10-01', '2027-04-30', 599000000, 250000000, 'Lease year 2027-04 → 2028-03') returning id)
insert into ids select 'goal', id from g;
select pg_temp.expect((select target = 0 and planned = 250000000 from performance_goals where id = pg_temp.id('goal')), 'an admin sets a goal; break even by default');
select pg_temp.fails(format($q$insert into performance_goals (organization_id, label, since, by_date) values (%L, 'x', '2027-01-01', '2026-01-01')$q$, pg_temp.id('org')),
  'new row', 'a goal ends after it starts');

-- Blocks: staff and admins.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into villa_blocks (organization_id, villa_id, starts_on, ends_on, reason, note)
  values (pg_temp.id('org'), pg_temp.id('villa'), '2026-10-20', '2026-10-29', 'owner', 'Our stay');
select pg_temp.expect((select count(*) = 1 from villa_blocks), 'staff note an owner stay');
select pg_temp.expect((select ends_on - starts_on = 9 from villa_blocks), 'nine nights, check-out excluded');

-- An owner sees the blocked nights of their own villa only.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
with v as (insert into villas (organization_id, name, currency) values (pg_temp.id('org'), 'Other villa', 'IDR') returning id)
insert into ids select 'villa2', id from v;
with o as (insert into owners (organization_id, name) values (pg_temp.id('org'), 'Owner Two') returning id)
insert into ids select 'owner2', id from o;
insert into villa_ownerships (organization_id, villa_id, owner_id, share_pct) values (pg_temp.id('org'), pg_temp.id('villa2'), pg_temp.id('owner2'), 100);
insert into memberships (organization_id, user_id, role, owner_id) values (pg_temp.id('org'), '00000000-0000-0000-0000-0000000000a2', 'owner_viewer', pg_temp.id('owner2'));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect((select count(*) = 0 from villa_blocks), 'an owner does not see the blocked nights of a villa they do not own');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.fails(format($q$insert into villa_blocks (organization_id, villa_id, starts_on, ends_on) values (%L, %L, '2026-10-20', '2026-10-20')$q$,
  pg_temp.id('org'), pg_temp.id('villa')), 'new row', 'a block lasts at least a night');
select pg_temp.expect((select count(*) = 0 from performance_goals), 'staff do not see the goals');
select pg_temp.fails(format($q$insert into performance_reports (organization_id, month, status, engine) values (%L, '2026-10-01', 'ready', 1)$q$, pg_temp.id('org')),
  'new row violates row-level security', 'staff do not write reports');

select pg_temp.fails(format('select public.performance_report_claim(%L, %L)', pg_temp.id('org'), '2026-09-01'), 'not_admin', 'staff do not claim a report');

-- Reports and actions: admins.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into ids select 'sept', public.performance_report_claim(pg_temp.id('org'), '2026-09-01');
select pg_temp.expect((select status = 'running' from performance_reports where id = pg_temp.id('sept')), 'an admin claims a month to write its report');
select pg_temp.expect((select public.performance_report_claim(pg_temp.id('org'), '2026-09-01')) is null, 'one writer at a time');
update performance_reports set status = 'ready', engine = 1 where id = pg_temp.id('sept');
select pg_temp.expect((select public.performance_report_claim(pg_temp.id('org'), '2026-09-01')) = pg_temp.id('sept'), 'a written report is rewritten in place');
update performance_reports set updated_at = now() - interval '11 minutes' where id = pg_temp.id('sept');
select pg_temp.expect((select public.performance_report_claim(pg_temp.id('org'), '2026-09-01')) = pg_temp.id('sept'), 'a writer that died is taken over');
with r as (insert into performance_reports (organization_id, month, status, engine, facts) values (pg_temp.id('org'), '2026-10-01', 'ready', 1, '{"x":1}') returning id)
insert into ids select 'report', id from r;
select pg_temp.fails(format($q$insert into performance_reports (organization_id, month, status, engine) values (%L, '2026-10-01', 'ready', 1)$q$, pg_temp.id('org')),
  'duplicate key', 'one report per month');
select pg_temp.fails(format($q$insert into performance_reports (organization_id, month, status, engine) values (%L, '2026-10-05', 'ready', 1)$q$, pg_temp.id('org')),
  'new row', 'a report is about a whole month');
with a as (insert into performance_actions (organization_id, report_id, position, villa_id, title, why, metrics, impact, impact_note, effort, due_on)
  values (pg_temp.id('org'), pg_temp.id('report'), 1, pg_temp.id('villa'), 'Open 2-night stays in the gaps', 'Six orphan nights in December.',
          '{calendar.orphan_nights}', 4500000, '6 nights × 750k ADR', 'low', '2026-11-15') returning id)
insert into ids select 'action', id from a;
select pg_temp.fails(format($q$insert into performance_actions (organization_id, report_id, position, title, why, effort) values (%L, %L, 31, 't', 'w', 'low')$q$,
  pg_temp.id('org'), pg_temp.id('report')), 'new row', 'a report keeps a bounded number of actions');

-- Staff cannot turn an action into a task (they do not see it).
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.fails(format('select public.performance_action_accept(%L)', pg_temp.id('action')), 'not_found', 'staff do not see the actions');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into ids select 'task', public.performance_action_accept(pg_temp.id('action'));
select pg_temp.expect((select title = 'Open 2-night stays in the gaps' and due_date = '2026-11-15' and villa_id = pg_temp.id('villa')
  and notes like 'Six orphan nights in December.%Expected: 6 nights × 750k ADR%' from tasks where id = pg_temp.id('task')), 'the action becomes a task, with why and what to expect');
select pg_temp.expect((select status = 'accepted' and task_id = pg_temp.id('task') and decided_by = '00000000-0000-0000-0000-00000000000a'
  from performance_actions where id = pg_temp.id('action')), 'and is marked accepted, by whom');
select pg_temp.expect((select public.performance_action_accept(pg_temp.id('action'))) = pg_temp.id('task'), 'a second tap gives the same task');
select pg_temp.expect((select count(*) = 1 from tasks), 'and no second task');
select pg_temp.fails(format($q$update performance_actions set status = 'dismissed', decided_at = null where id = %L$q$, pg_temp.id('action')),
  'new row', 'a decided action keeps its decision date');

select pg_temp.expect((select count(*) > 0 from audit_log where table_name = 'performance_reports'), 'reports are audited');

-- Another organization sees none of it.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) = 0 from performance_reports) and (select count(*) = 0 from performance_actions)
  and (select count(*) = 0 from villa_blocks) and (select count(*) = 0 from performance_goals), 'another organization sees nothing');
select pg_temp.fails(format('select public.performance_action_accept(%L)', pg_temp.id('action')), 'not_found', 'nor accepts an action');
insert into ids select 'orgB', public.create_organization('Org B', 'IDR');
with t as (insert into tasks (organization_id, title) values (pg_temp.id('orgB'), 'B task') returning id)
insert into ids select 'taskB', id from t;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.fails(format('update performance_actions set task_id = %L where id = %L', pg_temp.id('taskB'), pg_temp.id('action')),
  'insert or update', 'an action never points at another organization''s task');

-- Allowance: ten reports a month by default.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select public.ai_take(pg_temp.id('org'), 'performance', 12)) = 10, 'ten Sply Performance reports a month');
select pg_temp.expect((select quota = 10 and used = 10 from public.ai_quota(pg_temp.id('org')) where kind = 'performance'), 'shown with the others');
select pg_temp.expect((select public.ai_take(pg_temp.id('org'), 'bank_review', 1)) = 1, 'the other allowances still work');

rollback;
