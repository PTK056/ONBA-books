-- ONBA Books — tasks
--
-- Reminders entered from the assistant (WhatsApp agent, MCP) or the app: a payment to make,
-- evidence to bring in, anything to finish. Open tasks feed the assistant's "what's left to do".

create type public.task_kind as enum ('payment', 'evidence', 'todo');

create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  villa_id         uuid,
  kind             public.task_kind not null default 'todo',
  title            text not null check (length(trim(title)) > 0),
  notes            text,
  due_date         date,
  amount           numeric(18,2) check (amount is null or amount > 0),
  currency         char(3) check (currency ~ '^[A-Z]{3}$'),
  done_at          timestamptz,
  done_by          uuid references auth.users(id) on delete set null,
  created_by       uuid default auth.uid() references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  foreign key (villa_id, organization_id) references public.villas(id, organization_id) on delete cascade,
  check ((amount is null) = (currency is null))
);

create index tasks_open on public.tasks (organization_id, due_date) where done_at is null;

alter table public.tasks enable row level security;

create policy task_select on public.tasks for select to authenticated
  using (private.is_editor(organization_id));
create policy task_write on public.tasks for all to authenticated
  using (private.is_editor(organization_id)) with check (private.is_editor(organization_id));

create trigger audit after insert or update or delete on public.tasks
  for each row execute function private.audit();
