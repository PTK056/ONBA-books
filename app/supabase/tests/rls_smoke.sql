-- Smoke test for the core schema: tenant isolation, roles, closed months.
-- Runs after the migrations, as a superuser, inside a transaction that is rolled back.
-- Each "as_user" block switches to the authenticated role with a given JWT subject.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin-a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'admin-b@test.local'),
  ('00000000-0000-0000-0000-0000000000a1', 'staff-a@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'owner-a1@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'owner-a2@test.local');

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

-- Organization A (a manager with two villas), set up by its admin --------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');

insert into ids select 'orgA', public.create_organization('Org A', 'USD');
with x as (insert into villas (organization_id, name, currency)
  select v, 'Villa One', 'IDR' from ids where k = 'orgA' returning id) insert into ids select 'villa1', id from x;
with x as (insert into villas (organization_id, name, currency)
  select v, 'Villa Two', 'IDR' from ids where k = 'orgA' returning id) insert into ids select 'villa2', id from x;
with x as (insert into owners (organization_id, name)
  select v, 'Owner One' from ids where k = 'orgA' returning id) insert into ids select 'owner1', id from x;
with x as (insert into owners (organization_id, name)
  select v, 'Owner Two' from ids where k = 'orgA' returning id) insert into ids select 'owner2', id from x;

insert into villa_ownerships (organization_id, villa_id, owner_id, share_pct)
select (select v from ids where k='orgA'), (select v from ids where k='villa1'), (select v from ids where k='owner1'), 100;
insert into villa_ownerships (organization_id, villa_id, owner_id, share_pct)
select (select v from ids where k='orgA'), (select v from ids where k='villa2'), (select v from ids where k='owner2'), 100;

insert into memberships (organization_id, user_id, role, owner_id) values
  ((select v from ids where k='orgA'), '00000000-0000-0000-0000-0000000000a1', 'staff', null),
  ((select v from ids where k='orgA'), '00000000-0000-0000-0000-0000000000a2', 'owner_viewer', (select v from ids where k='owner1')),
  ((select v from ids where k='orgA'), '00000000-0000-0000-0000-0000000000a3', 'owner_viewer', (select v from ids where k='owner2'));

insert into transactions (organization_id, villa_id, date, direction, category_id, currency, amount, fx_rate, status)
select o.v, vi.v, d, dir::tx_direction, c.id, 'IDR', amt, 0.0000625, st::tx_status
from ids o, ids vi,
  (values ('villa1', date '2026-09-05', 'in',  'Accommodation', 16000000, 'validated'),
          ('villa1', date '2026-09-10', 'out', 'Utilities',      1600000, 'validated'),
          ('villa1', date '2026-09-12', 'out', 'Utilities',       800000, 'draft'),
          ('villa2', date '2026-09-07', 'in',  'Accommodation', 32000000, 'validated')) as t(villa, d, dir, cat, amt, st)
join categories c on c.name = t.cat
where o.k = 'orgA' and vi.k = t.villa;

select pg_temp.expect((select count(*) from categories) = 17, 'admin A sees the 17 default categories');
select pg_temp.expect((select count(*) from transactions) = 4, 'admin A sees all 4 transactions');
select pg_temp.expect(
  (select net from villa_month_totals where villa_id = (select v from ids where k='villa1')) = 900.00,
  'villa 1 net for Sept = 1000 - 100 USD (draft excluded)');

-- Organization B, separate tenant ------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into ids select 'orgB', public.create_organization('Org B', 'AUD');

select pg_temp.expect((select count(*) from villas) = 0,       'admin B sees no villa of org A');
select pg_temp.expect((select count(*) from transactions) = 0, 'admin B sees no transaction of org A');
select pg_temp.expect((select count(*) from organizations) = 1, 'admin B sees only their organization');
select pg_temp.expect((select count(*) from categories) = 17,  'admin B sees only their own categories');

do $$ begin
  insert into transactions (organization_id, villa_id, date, direction, currency, amount)
  values ((select v from ids where k='orgA'), (select v from ids where k='villa1'), '2026-09-20', 'out', 'IDR', 1);
  raise exception 'FAILED: admin B wrote into org A';
exception when insufficient_privilege then raise notice 'ok - admin B cannot write into org A';
end $$;

do $$ begin
  -- Pointing a B row at an A villa must fail even with a B organization_id.
  insert into transactions (organization_id, villa_id, date, direction, currency, amount)
  values ((select v from ids where k='orgB'), (select v from ids where k='villa1'), '2026-09-20', 'out', 'IDR', 1);
  raise exception 'FAILED: org B row referenced an org A villa';
exception when foreign_key_violation then raise notice 'ok - cross-tenant reference rejected';
end $$;

update transactions set amount = 1 where villa_id = (select v from ids where k='villa1');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select min(amount) from transactions) > 1, 'admin B update on org A rows had no effect');

-- Owner viewers -------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect((select count(*) from villas) = 1, 'owner 1 sees only Villa One');
select pg_temp.expect((select count(*) from transactions) = 2, 'owner 1 sees only the 2 validated rows of Villa One');
select pg_temp.expect((select count(*) from owners) = 1, 'owner 1 sees only themself among owners');
select pg_temp.expect((select count(*) from memberships) = 1, 'owner 1 sees only their own membership');

do $$ begin
  insert into transactions (organization_id, villa_id, date, direction, currency, amount)
  values ((select v from ids where k='orgA'), (select v from ids where k='villa1'), '2026-09-20', 'out', 'IDR', 1);
  raise exception 'FAILED: owner viewer wrote a transaction';
exception when insufficient_privilege then raise notice 'ok - owner viewer cannot write';
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select pg_temp.expect((select count(*) from villas) = 1
  and (select name from villas) = 'Villa Two', 'owner 2 sees only Villa Two');

-- Staff -----------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect((select count(*) from transactions) = 4, 'staff sees all transactions, drafts included');
update organizations set name = 'Hacked';
select pg_temp.expect((select name from organizations) = 'Org A', 'staff cannot rename the organization');
select pg_temp.expect((select count(*) from audit_log) = 0, 'staff cannot read the audit log');

-- Closed months ----------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into month_closes (organization_id, villa_id, month, status, closed_by, closed_at)
select (select v from ids where k='orgA'), (select v from ids where k='villa1'), '2026-09-01', 'closed', auth.uid(), now();

do $$ begin
  update transactions set amount = amount + 1
  where villa_id = (select v from ids where k='villa1') and date = '2026-09-10';
  raise exception 'FAILED: edited a closed month';
exception when check_violation then raise notice 'ok - closed month cannot be edited';
end $$;

do $$ begin
  insert into transactions (organization_id, villa_id, date, direction, currency, amount)
  values ((select v from ids where k='orgA'), (select v from ids where k='villa1'), '2026-09-28', 'out', 'IDR', 1);
  raise exception 'FAILED: inserted into a closed month';
exception when check_violation then raise notice 'ok - closed month rejects new rows';
end $$;

insert into transactions (organization_id, villa_id, date, direction, currency, amount, fx_rate, status, source, adjusts_transaction_id)
select (select v from ids where k='orgA'), (select v from ids where k='villa1'), '2026-10-02', 'out', 'IDR', 160000, 0.0000625,
  'validated', 'adjustment', (select id from transactions where date = '2026-09-10');
select pg_temp.expect(true, 'adjustment recorded in the open month');

select pg_temp.expect((select count(*) from villas where name = 'Villa Two') = 1
  and (select count(*) from transactions where villa_id = (select v from ids where k='villa2')) = 1,
  'Villa Two (not closed) unaffected');

select pg_temp.expect((select count(*) from audit_log where table_name = 'transactions') = 5,
  'audit log has one entry per transaction write');

select pg_temp.expect(
  (select count(*) from expenses_missing_evidence) = 2,
  'two validated expenses lack evidence');

rollback;
