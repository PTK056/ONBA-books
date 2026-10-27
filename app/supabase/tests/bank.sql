-- Bank module: admins only, one line per fingerprint, one line per transaction, unlinked lines go back to the list.

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
create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into ids select 'org', public.create_organization('Org A', 'IDR');
insert into memberships (organization_id, user_id, role)
select v, '00000000-0000-0000-0000-0000000000a1', 'staff' from ids where k = 'org';
with v as (insert into villas (organization_id, name, currency) select v, 'Villa', 'IDR' from ids where k = 'org' returning id)
insert into ids select 'villa', id from v;
with a as (insert into bank_accounts (organization_id, name, institution, currency, last4)
  select v, 'Danamon', 'danamon', 'IDR', '4821' from ids where k = 'org' returning id)
insert into ids select 'acct', id from a;
with s as (insert into bank_statements (organization_id, account_id, storage_path, mime_type)
  select o.v, a.v, o.v || '/s.pdf', 'application/pdf' from ids o, ids a where o.k = 'org' and a.k = 'acct' returning id)
insert into ids select 'stmt', id from s;

insert into bank_lines (organization_id, account_id, statement_id, date, direction, amount, currency, description, fingerprint)
select o.v, a.v, s.v, '2026-10-03', 'out', 350000, 'IDR', 'TRF KE KADEK', 'fp1'
from ids o, ids a, ids s where o.k = 'org' and a.k = 'acct' and s.k = 'stmt';
select pg_temp.expect(true, 'admin adds an account, a statement and a line');

do $$ begin
  insert into bank_lines (organization_id, account_id, statement_id, date, direction, amount, currency, fingerprint)
  select o.v, a.v, s.v, '2026-10-03', 'out', 350000, 'IDR', 'fp1'
  from ids o, ids a, ids s where o.k = 'org' and a.k = 'acct' and s.k = 'stmt';
  raise exception 'FAILED: the same line was stored twice';
exception when unique_violation then raise notice 'ok - a line seen in two statements is stored once';
end $$;

with t as (insert into transactions (organization_id, villa_id, date, direction, currency, amount, status, description)
  select o.v, vl.v, '2026-10-02', 'out', 'IDR', 350000, 'validated', 'Kadek salary' from ids o, ids vl where o.k = 'org' and vl.k = 'villa' returning id)
insert into ids select 'tx', id from t;
update bank_lines set status = 'matched', transaction_id = (select v from ids where k = 'tx'), matched_by = 'auto';
select pg_temp.expect((select status from bank_lines) = 'matched', 'a line is matched to a transaction');

delete from transactions where id = (select v from ids where k = 'tx');
select pg_temp.expect((select status = 'unmatched' and matched_by is null from bank_lines), 'deleting the transaction puts the line back in the list');

with st as (insert into stays (organization_id, villa_id, platform, external_ref, check_in, check_out, currency, gross_amount)
  select o.v, vl.v, 'airbnb', 'HMTEST', '2026-10-01', '2026-10-03', 'IDR', 350000 from ids o, ids vl where o.k = 'org' and vl.k = 'villa' returning id)
insert into ids select 'stay', id from st;
update bank_lines set status = 'matched', matched_by = 'auto';
insert into bank_line_stays (organization_id, line_id, stay_id)
select o.v, (select id from bank_lines), s.v from ids o, ids s where o.k = 'org' and s.k = 'stay';
delete from stays where id = (select v from ids where k = 'stay');
select pg_temp.expect((select status = 'unmatched' from bank_lines), 'deleting the stay a payout was linked to puts the line back');

update bank_lines set status = 'personal';
select pg_temp.expect((select status from bank_lines) = 'personal', 'a line can be marked personal');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect((select count(*) from bank_lines) + (select count(*) from bank_statements) + (select count(*) from bank_accounts) = 0,
  'staff sees no account, statement or line');
do $$ begin
  insert into storage.objects (bucket_id, name) select 'bank', v || '/x.pdf' from ids where k = 'org';
  raise exception 'FAILED: staff uploaded a statement';
exception when insufficient_privilege then raise notice 'ok - staff cannot upload a statement';
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from bank_lines) = 0, 'other organization sees nothing');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select public.ai_take(v, 'bank_statement', 25) from ids where k = 'org') = 20, 'statement reading quota is 20 a month');

rollback;
