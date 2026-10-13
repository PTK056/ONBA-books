-- Stays import: create, re-import unchanged, update, closed month, tenant isolation.
-- Same conventions as rls_smoke.sql: superuser, one transaction, rolled back.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin-a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'admin-b@test.local');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u::text, true);
$$;
create function pg_temp.id(key text) returns uuid language sql as $$ select v from ids where k = key $$;
create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into ids select 'orgA', public.create_organization('Org A', 'IDR');
with x as (insert into villas (organization_id, name, currency) select pg_temp.id('orgA'), 'Villa One', 'IDR' returning id)
  insert into ids select 'villa', id from x;

select pg_temp.expect((select count(*) from categories where name = 'Platform fees') = 1, 'new organizations get a Platform fees category');

-- A stay across August and September, as the app sends it.
create temp table payload (j jsonb);
grant all on payload to authenticated;
insert into payload values ('[{
  "code": "HMCCC", "guest": "Cleo", "check_in": "2026-08-28", "check_out": "2026-09-05",
  "currency": "EUR", "gross": 900, "fees": 153.45, "payout_date": "2026-08-31",
  "lines": [
    {"date": "2026-08-28", "direction": "in",  "category": "Accommodation", "amount": 450,   "currency": "EUR", "fx_rate": 20568.6, "description": "Airbnb HMCCC · 4 of 8 nights"},
    {"date": "2026-08-28", "direction": "out", "category": "Platform fees", "amount": 76.72, "currency": "EUR", "fx_rate": 20568.6, "description": "Airbnb HMCCC · 4 of 8 nights · host fee"},
    {"date": "2026-09-01", "direction": "in",  "category": "Accommodation", "amount": 450,   "currency": "EUR", "fx_rate": 20568.6, "description": "Airbnb HMCCC · 4 of 8 nights"},
    {"date": "2026-09-01", "direction": "out", "category": "Platform fees", "amount": 76.73, "currency": "EUR", "fx_rate": 20568.6, "description": "Airbnb HMCCC · 4 of 8 nights · host fee"}
  ]}]');

create temp table result (j jsonb);
grant all on result to authenticated;
insert into result select public.import_stays(pg_temp.id('villa'), 'airbnb', (select j from payload));
select pg_temp.expect((select j->>'created' from result) = '1', 'first import creates the stay');
select pg_temp.expect((select count(*) from stays) = 1 and (select nights from stays) = 8, 'stay stored with 8 nights');
select pg_temp.expect((select count(*) from transactions where source = 'stay' and status = 'validated') = 4, 'four validated lines, two per month');
select pg_temp.expect(
  (select net from villa_month_totals where month = '2026-08-01') = round(450 * 20568.6, 2) - round(76.72 * 20568.6, 2),
  'August net in IDR = income minus fee, at the payout rate');
select pg_temp.expect((select count(*) from transactions t join categories c on c.id = t.category_id
  where c.name = 'Platform fees' and t.direction = 'out') = 2, 'fees booked in Platform fees');
select pg_temp.expect((select count(*) from expenses_missing_evidence) = 0, 'imported fees are not listed as missing a receipt');

-- Same file again: nothing changes.
delete from result;
insert into result select public.import_stays(pg_temp.id('villa'), 'airbnb', (select j from payload));
select pg_temp.expect((select j->>'unchanged' from result) = '1' and (select j->>'created' from result) = '0', 're-import of the same data is a no-op');
select pg_temp.expect((select count(*) from transactions) = 4, 'no duplicate lines');

-- Airbnb changes the booking (e.g. an alteration): lines are replaced.
update payload set j = jsonb_set(jsonb_set(j, '{0,gross}', '1000'), '{0,lines,0,amount}', '550');
delete from result;
insert into result select public.import_stays(pg_temp.id('villa'), 'airbnb', (select j from payload));
select pg_temp.expect((select j->>'updated' from result) = '1', 'changed booking is updated');
select pg_temp.expect((select gross_amount from stays) = 1000 and (select count(*) from transactions) = 4
  and (select amount from transactions where date = '2026-08-28' and direction = 'in') = 550, 'stay and its lines replaced');

-- A closed August: the stay is reported, other stays still import.
insert into month_closes (organization_id, villa_id, month, status, closed_by, closed_at)
  values (pg_temp.id('orgA'), pg_temp.id('villa'), '2026-08-01', 'closed', auth.uid(), now());
update payload set j = jsonb_set(j, '{0,gross}', '1100') || '[{
  "code": "HMBBB", "guest": "Ben", "check_in": "2026-09-18", "check_out": "2026-09-20",
  "currency": "EUR", "gross": 111.98, "fees": 19.1, "payout_date": "2026-09-21",
  "lines": [
    {"date": "2026-09-18", "direction": "in",  "category": "Accommodation", "amount": 111.98, "currency": "EUR", "fx_rate": 20386.1, "description": "Airbnb HMBBB · 2 of 2 nights"},
    {"date": "2026-09-18", "direction": "out", "category": "Platform fees", "amount": 19.1,   "currency": "EUR", "fx_rate": 20386.1, "description": "Airbnb HMBBB · 2 of 2 nights · host fee"}
  ]}]'::jsonb;
delete from result;
insert into result select public.import_stays(pg_temp.id('villa'), 'airbnb', (select j from payload));
select pg_temp.expect((select jsonb_array_length(j->'conflicts') from result) = 1 and (select j->'conflicts'->0->>'code' from result) = 'HMCCC',
  'stay touching a closed month is reported as a conflict');
select pg_temp.expect((select gross_amount from stays where external_ref = 'HMCCC') = 1000, 'conflicting stay left as it was');
select pg_temp.expect((select j->>'created' from result) = '1' and (select count(*) from stays) = 2, 'the other stay still imported');

-- Another tenant cannot import into this villa.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into ids select 'orgB', public.create_organization('Org B');
do $$ begin
  perform public.import_stays(pg_temp.id('villa'), 'airbnb', '[]'::jsonb);
  raise exception 'FAILED: org B imported into org A';
exception when no_data_found then raise notice 'ok - another organization cannot import into this villa';
end $$;

rollback;
