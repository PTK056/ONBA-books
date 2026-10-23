-- Tasks: editors of an organization see and manage its tasks; nobody else does.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin-a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'admin-b@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'owner-a@test.local');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u::text, true);
$$;
create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into ids select 'orgA', public.create_organization('Org A', 'IDR');
with x as (insert into villas (organization_id, name, currency)
  select v, 'Villa One', 'IDR' from ids where k = 'orgA' returning id) insert into ids select 'villa1', id from x;
with x as (insert into owners (organization_id, name)
  select v, 'Owner One' from ids where k = 'orgA' returning id) insert into ids select 'owner1', id from x;
insert into memberships (organization_id, user_id, role, owner_id)
select v, '00000000-0000-0000-0000-0000000000a2', 'owner_viewer', (select v from ids where k = 'owner1') from ids where k = 'orgA';

insert into tasks (organization_id, villa_id, kind, title, due_date, amount, currency)
select (select v from ids where k = 'orgA'), (select v from ids where k = 'villa1'), 'payment', 'Pay PLN electricity', date '2026-10-25', 850000, 'IDR';
insert into tasks (organization_id, title) select v, 'Send Kadek''s receipts' from ids where k = 'orgA';
select pg_temp.expect((select count(*) from tasks) = 2, 'admin creates tasks');
select pg_temp.expect((select created_by from tasks limit 1) = '00000000-0000-0000-0000-00000000000a', 'created_by is the caller');

do $$ begin
  insert into tasks (organization_id, title, amount) select v, 'Amount without currency', 10 from ids where k = 'orgA';
  raise exception 'FAILED: amount without currency accepted';
exception when check_violation then raise notice 'ok - amount needs a currency';
end $$;

update tasks set done_at = now(), done_by = auth.uid() where title = 'Pay PLN electricity';
select pg_temp.expect((select count(*) from tasks where done_at is null) = 1, 'admin completes a task');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect((select count(*) from tasks) = 0, 'owner viewer sees no tasks');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from tasks) = 0, 'other organization sees no tasks');
do $$ begin
  insert into tasks (organization_id, title) select v, 'Intrusion' from ids where k = 'orgA';
  raise exception 'FAILED: other organization inserted a task';
exception when insufficient_privilege then raise notice 'ok - other organization cannot add tasks';
end $$;

rollback;
