-- Download log: who took which documents out of the app (ZIP, share link, single download).
-- Members write their own rows (the app does it on their behalf); only admins read them.
-- Limit: files read straight from the storage API with a session are not seen here.

create type public.download_kind as enum ('zip', 'share_link', 'file');

create table public.download_log (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid default auth.uid() references auth.users(id) on delete set null, -- email kept if the account goes
  user_email       text,
  kind             public.download_kind not null,
  files            integer not null default 1 check (files >= 0),
  details          jsonb not null default '{}',
  created_at       timestamptz not null default now()
);

create index download_log_recent on public.download_log (organization_id, created_at desc);

alter table public.download_log enable row level security;

create policy download_log_insert on public.download_log for insert to authenticated
  with check (private.is_member(organization_id) and user_id = auth.uid());
create policy download_log_select on public.download_log for select to authenticated
  using (private.is_admin(organization_id));
-- No update or delete policy: entries cannot be edited or removed by anyone in the app.
