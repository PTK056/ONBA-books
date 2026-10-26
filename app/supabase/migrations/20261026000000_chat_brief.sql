-- ONBA Books — morning brief in chat channels
--
-- Each morning the server sends linked chats what is left to do (nothing if nothing is).
-- The brief is kept with the conversation so a reply to it ("paid it") has its context.

alter table public.channel_links add column brief_enabled boolean not null default true;

alter table public.chat_conversations
  add column brief     text,
  add column brief_at  timestamptz;
