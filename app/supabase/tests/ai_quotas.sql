-- AI quotas: members spend up to the month's limit, nobody else can, and only the service role raises a limit.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin-a@test.local'),
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

select pg_temp.expect((select public.ai_take(v, 'receipt', 60) from ids where k = 'orgA') = 60, 'first 60 receipts granted');
select pg_temp.expect((select public.ai_take(v, 'receipt', 60) from ids where k = 'orgA') = 40, 'only the 40 left of 100 granted');
select pg_temp.expect((select public.ai_take(v, 'receipt', 1) from ids where k = 'orgA') = 0, 'nothing once used up');
select pg_temp.expect((select public.ai_take(v, 'receipt', -5) from ids where k = 'orgA') = 0, 'no units given back');
select pg_temp.expect((select used from public.ai_quota((select v from ids where k = 'orgA')) where kind = 'receipt') = 100,
  'usage shows 100 used');
select pg_temp.expect((select public.ai_take(v, 'agent_message') from ids where k = 'orgA') = 1, 'other quotas are separate');

do $$ begin
  insert into private.ai_limits (organization_id, receipt) select v, 1000 from ids where k = 'orgA';
  raise exception 'FAILED: an admin raised their own limit';
exception when insufficient_privilege then raise notice 'ok - an admin cannot raise their own limit';
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform public.ai_take(v, 'receipt') from ids where k = 'orgA';
  raise exception 'FAILED: an outsider spent the quota';
exception when insufficient_privilege then raise notice 'ok - an outsider cannot spend the quota';
end $$;
select pg_temp.expect((select count(*) from public.ai_quota((select v from ids where k = 'orgA'))) = 0, 'an outsider sees no usage');

select public.create_organization('B1'), public.create_organization('B2'), public.create_organization('B3');
do $$ begin
  perform public.create_organization('B4');
  raise exception 'FAILED: a fourth organization was created';
exception when insufficient_privilege then raise notice 'ok - one account creates at most 3 organizations';
end $$;

reset role;
insert into private.ai_limits (organization_id, receipt) select v, 150 from ids where k = 'orgA';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select public.ai_take(v, 'receipt', 80) from ids where k = 'orgA') = 50, 'a raised limit grants the difference');

rollback;
