-- The user's last real sentence in a chat, kept across conversation resets, so the morning
-- brief is written in their language even when the current conversation is empty.
alter table public.channel_links add column last_user_text text;
