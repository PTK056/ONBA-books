-- Download log: members add their own entries, only admins read, nobody edits or deletes.

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
insert into ids select 'orgA', public.create_organization('Org A', 'IDR');
insert into memberships (organization_id, user_id, role)
select v, '00000000-0000-0000-0000-0000000000a1', 'staff' from ids where k = 'orgA';

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into download_log (organization_id, kind, files, details) select v, 'zip', 42, '{"month": "2026-09"}' from ids where k = 'orgA';
select pg_temp.expect(true, 'staff logs a ZIP download');
select pg_temp.expect((select count(*) from download_log) = 0, 'staff cannot read the log');
do $$ begin
  insert into download_log (organization_id, user_id, kind) select v, '00000000-0000-0000-0000-00000000000a', 'file' from ids where k = 'orgA';
  raise exception 'FAILED: staff logged a download as someone else';
exception when insufficient_privilege then raise notice 'ok - nobody logs in someone else''s name';
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select files from download_log where kind = 'zip') = 42, 'admin reads the log');
update download_log set files = 0;
delete from download_log;
select pg_temp.expect((select count(*) from download_log) = 1, 'even an admin cannot edit or delete entries');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from download_log) = 0, 'other organization sees nothing');

rollback;
