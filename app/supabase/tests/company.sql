-- The company: one per organization, never a place to stay or to own, never archived; entries can go on it.

begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'admin-a@test.local');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
insert into ids select 'org', public.create_organization('Org A', 'IDR');
insert into ids select 'company', id from villas where kind = 'company';
select pg_temp.expect((select count(*) from villas where kind = 'company') = 1, 'a new organization comes with its company');
with v as (insert into villas (organization_id, name, currency) select v, 'Villa', 'IDR' from ids where k = 'org' returning id)
insert into ids select 'villa', id from v;

insert into transactions (organization_id, villa_id, date, direction, currency, amount, status, description)
select o.v, c.v, '2026-10-05', 'out', 'IDR', 26100, 'validated', 'Bank fees' from ids o, ids c where o.k = 'org' and c.k = 'company';
select pg_temp.expect(true, 'an entry can go on the company');

do $$ begin
  insert into stays (organization_id, villa_id, platform, check_in, check_out, currency, gross_amount)
  select o.v, c.v, 'airbnb', '2026-10-01', '2026-10-02', 'IDR', 1 from ids o, ids c where o.k = 'org' and c.k = 'company';
  raise exception 'FAILED: a stay on the company';
exception when check_violation then raise notice 'ok - no stay on the company';
end $$;

do $$ begin
  insert into villas (organization_id, name, currency, kind) select v, 'Second', 'IDR', 'company' from ids where k = 'org';
  raise exception 'FAILED: a second company';
exception when unique_violation then raise notice 'ok - only one company';
end $$;

do $$ begin
  update villas set archived_at = now() where id = (select v from ids where k = 'company');
  raise exception 'FAILED: the company was archived';
exception when check_violation then raise notice 'ok - the company cannot be archived';
end $$;

do $$ begin
  update villas set kind = 'company' where id = (select v from ids where k = 'villa');
  raise exception 'FAILED: a villa became the company';
exception when check_violation or unique_violation then raise notice 'ok - a villa cannot become the company';
end $$;

update villas set name = 'Bali Stays (company)' where id = (select v from ids where k = 'company');
select pg_temp.expect((select name from villas where kind = 'company') = 'Bali Stays (company)', 'the company can be renamed');

rollback;
