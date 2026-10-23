-- Chat channels: server-only tables, and the per-chat queue (enqueue / claim / take / release).

begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'admin-a@test.local');

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

insert into channel_links (id, user_id, channel, external_id, refresh_token_enc)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'telegram', '42', 'enc');

-- Queue, as the server would drive it.
select chat_enqueue('10000000-0000-0000-0000-000000000001', '{"text": "hello"}');
select pg_temp.expect(chat_claim('10000000-0000-0000-0000-000000000001'), 'first worker gets the lease');
select pg_temp.expect(not chat_claim('10000000-0000-0000-0000-000000000001'), 'second worker does not');
select chat_enqueue('10000000-0000-0000-0000-000000000001', '{"text": "and a photo"}');
select pg_temp.expect(jsonb_array_length(chat_take('10000000-0000-0000-0000-000000000001')) = 2, 'worker takes both messages, in order');
select pg_temp.expect(jsonb_array_length(chat_take('10000000-0000-0000-0000-000000000001')) = 0, 'queue is then empty');
select chat_enqueue('10000000-0000-0000-0000-000000000001', '{"text": "late"}');
select pg_temp.expect(chat_release('10000000-0000-0000-0000-000000000001'), 'release reports a message that arrived meanwhile');
select pg_temp.expect(chat_claim('10000000-0000-0000-0000-000000000001'), 'lease can be taken again');
select pg_temp.expect(jsonb_array_length(chat_take('10000000-0000-0000-0000-000000000001')) = 1, 'next worker takes the late message');
select pg_temp.expect(not chat_release('10000000-0000-0000-0000-000000000001'), 'release with nothing left reports nothing');

-- Users cannot read links or call the queue.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select pg_temp.expect((select count(*) from channel_links) = 0, 'a user cannot read links, even their own');
select pg_temp.expect((select count(*) from chat_conversations) = 0, 'a user cannot read conversations');
do $$ begin
  perform public.chat_enqueue('10000000-0000-0000-0000-000000000001', '{}');
  raise exception 'FAILED: user called chat_enqueue';
exception when insufficient_privilege then raise notice 'ok - a user cannot call the queue';
end $$;

rollback;
