-- ONBA Books — chat channels (Telegram now, WhatsApp later)
--
-- A user links a chat to their account from the app: the OAuth flow gives the server a refresh
-- token for that user, and a one-time code that only their own Telegram can redeem (/start CODE).
-- The agent then acts with that user's token, so RLS applies as in the app.
-- Both tables are server-only: RLS on, no policies; the server uses the secret key.

create table public.channel_links (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  channel               text not null check (channel in ('telegram', 'whatsapp')),
  external_id           text,                 -- chat id, set when the code is redeemed
  external_name         text,
  link_code_hash        text unique,          -- sha256 of the one-time code
  link_code_expires_at  timestamptz,
  refresh_token_enc     text not null,        -- AES-GCM, key outside the database
  access_token_enc      text,
  access_expires_at     timestamptz,
  created_at            timestamptz not null default now(),
  linked_at             timestamptz,
  last_used_at          timestamptz,
  unique (channel, external_id)
);

create table public.chat_conversations (
  link_id      uuid primary key references public.channel_links(id) on delete cascade,
  messages     jsonb not null default '[]',   -- Claude messages, append-only within a conversation
  attachments  jsonb not null default '{}',   -- { "att_1": { "path": …, "mimeType": … } }
  pending      jsonb not null default '[]',   -- incoming messages not yet answered
  busy_until   timestamptz,                   -- a worker is answering
  updated_at   timestamptz not null default now()
);

alter table public.channel_links enable row level security;
alter table public.chat_conversations enable row level security;

-- Queue: messages are appended here; one worker per chat answers them in order.
create function public.chat_enqueue(p_link uuid, p_item jsonb) returns void
language sql set search_path = '' as $$
  insert into public.chat_conversations (link_id, pending) values (p_link, jsonb_build_array(p_item))
  on conflict (link_id) do update set pending = public.chat_conversations.pending || excluded.pending;
$$;

-- Takes the worker lease if free (or expired). True if the caller is now the worker.
create function public.chat_claim(p_link uuid, p_seconds int default 280) returns boolean
language sql set search_path = '' as $$
  with c as (
    update public.chat_conversations set busy_until = now() + make_interval(secs => p_seconds)
     where link_id = p_link and (busy_until is null or busy_until < now())
    returning 1
  ) select exists (select 1 from c);
$$;

-- Worker: takes everything pending.
create function public.chat_take(p_link uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare
  items jsonb;
begin
  select pending into items from public.chat_conversations where link_id = p_link for update;
  update public.chat_conversations set pending = '[]' where link_id = p_link;
  return coalesce(items, '[]'::jsonb);
end;
$$;

-- Worker: releases the lease. True if messages arrived meanwhile (the caller should claim again).
create function public.chat_release(p_link uuid) returns boolean
language sql set search_path = '' as $$
  update public.chat_conversations set busy_until = null
   where link_id = p_link
  returning jsonb_array_length(pending) > 0;
$$;

revoke execute on function public.chat_enqueue(uuid, jsonb), public.chat_claim(uuid, int),
  public.chat_take(uuid), public.chat_release(uuid) from public, anon, authenticated;
