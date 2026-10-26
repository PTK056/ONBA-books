-- Staff module: editors manage staff, work and pay; owner viewers and other organizations see nothing.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin-a@test.local'),
  ('00000000-0000-0000-0000-0000000000a1', 'staff-a@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'owner-a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'admin-b@test.local');

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
with x as (insert into villas (organization_id, name, currency) select v, 'Villa One', 'IDR' from ids where k = 'orgA' returning id)
  insert into ids select 'villa1', id from x;
with x as (insert into owners (organization_id, name) select v, 'Owner One' from ids where k = 'orgA' returning id)
  insert into ids select 'owner1', id from x;
insert into memberships (organization_id, user_id, role, owner_id) values
  ((select v from ids where k = 'orgA'), '00000000-0000-0000-0000-0000000000a1', 'staff', null),
  ((select v from ids where k = 'orgA'), '00000000-0000-0000-0000-0000000000a2', 'owner_viewer', (select v from ids where k = 'owner1'));

with x as (insert into staff (organization_id, name, role, pay_mode, currency, monthly_amount, base_unit, base_per_week, villa_id)
  select (select v from ids where k = 'orgA'), 'Kadek', 'Housekeeper', 'monthly', 'IDR', 2000000, 'visits', 3, (select v from ids where k = 'villa1')
  returning id) insert into ids select 'kadek', id from x;
with x as (insert into staff (organization_id, name, kind, pay_mode, currency, job_rate)
  select v, 'Delia', 'freelance', 'per_job', 'IDR', 150000 from ids where k = 'orgA' returning id) insert into ids select 'delia', id from x;
select pg_temp.expect((select count(*) from staff) = 2, 'admin adds a monthly employee and a per-job freelancer');

do $$ begin
  insert into staff (organization_id, name, pay_mode, currency) select v, 'No rate', 'hourly', 'IDR' from ids where k = 'orgA';
  raise exception 'FAILED: hourly staff without a rate accepted';
exception when check_violation then raise notice 'ok - an hourly person needs a rate';
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into work_logs (organization_id, staff_id, villa_id, date, jobs, task)
select (select v from ids where k = 'orgA'), (select v from ids where k = 'delia'), (select v from ids where k = 'villa1'), date '2026-10-03', 1, 'Full cleaning';
insert into work_logs (organization_id, staff_id, date, extra_amount, note)
select (select v from ids where k = 'orgA'), (select v from ids where k = 'kadek'), date '2026-10-12', 150000, 'Extra night shift';
select pg_temp.expect((select count(*) from work_logs) = 2, 'staff user logs work');
do $$ begin
  insert into work_logs (organization_id, staff_id, date) select (select v from ids where k = 'orgA'), (select v from ids where k = 'kadek'), date '2026-10-13';
  raise exception 'FAILED: empty work log accepted';
exception when check_violation then raise notice 'ok - a log needs hours, jobs or an extra';
end $$;

insert into pay_runs (organization_id, staff_id, month, amount, currency, breakdown)
select (select v from ids where k = 'orgA'), (select v from ids where k = 'delia'), date '2026-10-01', 150000, 'IDR', '{"jobs":1}';
do $$ begin
  insert into pay_runs (organization_id, staff_id, month, amount, currency)
  select (select v from ids where k = 'orgA'), (select v from ids where k = 'delia'), date '2026-10-01', 1, 'IDR';
  raise exception 'FAILED: two pay runs for the same month';
exception when unique_violation then raise notice 'ok - one pay run per person per month';
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect((select count(*) from staff) + (select count(*) from work_logs) + (select count(*) from pay_runs) = 0, 'owner viewer sees no staff, work or pay');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from staff) = 0, 'other organization sees no staff');
do $$ begin
  insert into work_logs (organization_id, staff_id, date, jobs) select (select v from ids where k = 'orgA'), (select v from ids where k = 'kadek'), date '2026-10-14', 1;
  raise exception 'FAILED: other organization logged work';
exception when insufficient_privilege then raise notice 'ok - other organization cannot log work';
end $$;

rollback;
