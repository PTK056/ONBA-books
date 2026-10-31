-- Stays from e-mails: source and status, the export wins over e-mails, admins only.
-- Same conventions as rls_smoke.sql: superuser, one transaction, rolled back.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin-a@test.local'),
  ('00000000-0000-0000-0000-0000000000a1', 'staff-a@test.local'),
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
create function pg_temp.stay(code text, gross numeric, source text, status text default null) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
    'code', code, 'guest', 'Jane', 'check_in', '2026-10-30', 'check_out', '2026-11-06',
    'currency', 'EUR', 'gross', gross, 'fees', 87.40, 'payout_date', null, 'source', source, 'status', status,
    'lines', jsonb_build_array(
      jsonb_build_object('date', '2026-10-30', 'direction', 'in', 'category', 'Accommodation', 'amount', gross,
                         'currency', 'EUR', 'fx_rate', 20000, 'description', 'Airbnb ' || code)))));
$$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into ids select 'org', public.create_organization('Org A', 'IDR');
insert into memberships (organization_id, user_id, role)
select pg_temp.id('org'), '00000000-0000-0000-0000-0000000000a1', 'staff';
with x as (insert into villas (organization_id, name, currency) select pg_temp.id('org'), 'Villa One', 'IDR' returning id)
  insert into ids select 'villa', id from x;

-- An e-mail creates the stay.
select public.import_stays(pg_temp.id('villa'), 'airbnb', pg_temp.stay('HMAAAA0001', 512.55, 'email'));
select pg_temp.expect((select source::text || '/' || status::text from stays where external_ref = 'HMAAAA0001') = 'email/confirmed',
  'a confirmation e-mail creates a confirmed stay, source email');

-- The same e-mail again changes nothing; a payout e-mail with the real rate rewrites it.
select pg_temp.expect((public.import_stays(pg_temp.id('villa'), 'airbnb', pg_temp.stay('HMAAAA0001', 512.55, 'email')))->>'unchanged' = '1',
  'same e-mail twice: unchanged');

-- The export then takes over: lines rewritten, source import.
select public.import_stays(pg_temp.id('villa'), 'airbnb', pg_temp.stay('HMAAAA0001', 500, null));
select pg_temp.expect((select source::text || '/' || gross_amount from stays where external_ref = 'HMAAAA0001') = 'import/500.00',
  'the export rewrites a stay that came from e-mails');

-- Later e-mails never rewrite what the export wrote, only the status.
select public.import_stays(pg_temp.id('villa'), 'airbnb', pg_temp.stay('HMAAAA0001', 999, 'email'));
select pg_temp.expect((select gross_amount from stays where external_ref = 'HMAAAA0001') = 500
  and (select sum(amount) from transactions t join stays s on s.id = t.stay_id where s.external_ref = 'HMAAAA0001') = 500,
  'an e-mail does not rewrite a stay from the export');
select public.import_stays(pg_temp.id('villa'), 'airbnb', pg_temp.stay('HMAAAA0001', 999, 'email', 'canceled'));
select pg_temp.expect((select status::text || '/' || gross_amount from stays where external_ref = 'HMAAAA0001') = 'canceled/500.00',
  'a cancellation e-mail marks an exported stay canceled, amounts untouched');

-- A re-import of the export without a status keeps the cancellation.
select public.import_stays(pg_temp.id('villa'), 'airbnb', pg_temp.stay('HMAAAA0001', 500, null));
select pg_temp.expect((select status from stays where external_ref = 'HMAAAA0001') = 'canceled', 'export re-import keeps the status');

-- Connection, e-mails, payouts and listings: admins only.
insert into mail_connections (organization_id, external_id) select pg_temp.id('org'), 'ca_test';
insert into inbound_emails (organization_id, external_id, kind, result, code)
select pg_temp.id('org'), 'msg1', 'confirmed', 'booked', 'HMAAAA0001';
insert into stay_payouts (organization_id, platform, code, payout_ref, sent_on, check_in, check_out, amount, currency, received, received_currency)
select pg_temp.id('org'), 'airbnb', 'HMAAAA0001', 'P1', '2026-10-31', '2026-10-30', '2026-11-06', 425.15, 'EUR', 8600000, 'IDR';
insert into listing_villas (organization_id, platform, listing_ref, villa_id)
select pg_temp.id('org'), 'airbnb', '1000000000000000001', pg_temp.id('villa');
do $$ begin
  insert into inbound_emails (organization_id, external_id, kind, result) select v, 'msg1', 'ignored', 'ignored' from ids where k = 'org';
  raise exception 'FAILED: same Gmail message stored twice';
exception when unique_violation then raise notice 'ok - one row per Gmail message';
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect((select count(*) from mail_connections) + (select count(*) from inbound_emails)
  + (select count(*) from stay_payouts) + (select count(*) from listing_villas) = 0, 'staff sees no connection, e-mail, payout or listing');
select pg_temp.expect((select count(*) from stays) = 1, 'staff still sees the stay');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from mail_connections) + (select count(*) from inbound_emails) = 0, 'other organization sees nothing');

rollback;
