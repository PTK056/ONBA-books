-- ONBA Books — receipt engine (v0.1)
--
-- Flow:
--   1. The app creates a receipt_batch, uploads each photo/PDF to the "evidence"
--      bucket under <organization_id>/<uuid>.<ext>, and inserts one evidence row and
--      one receipt_item per file.
--   2. It calls the read-receipts Edge Function with the batch id. The function reads
--      every unread item with Claude, writes the result to receipt_items.proposed and
--      evidence.extracted, then sets the batch to 'to_review'. Re-calling it resumes.
--   3. A person reviews each item and calls accept_receipt_item() (with any
--      corrections) or reject_receipt_item(). Nothing reaches the books unreviewed.

-- ---------------------------------------------------------------------------
-- Storage: private bucket, one folder per organization
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', false)
on conflict (id) do nothing;

create policy evidence_editor_read on storage.objects for select to authenticated
  using (
    bucket_id = 'evidence'
    and private.is_editor(((storage.foldername(name))[1])::uuid)
  );

-- Owner viewers can open a file only through an evidence row they are allowed to see.
create policy evidence_viewer_read on storage.objects for select to authenticated
  using (
    bucket_id = 'evidence'
    and exists (select 1 from public.evidence e where e.storage_path = name)
  );

create policy evidence_editor_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'evidence'
    and private.is_editor(((storage.foldername(name))[1])::uuid)
  );

create policy evidence_admin_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'evidence'
    and private.is_admin(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- Review
-- ---------------------------------------------------------------------------

-- Turns a reviewed item into a validated transaction and attaches its evidence.
-- Runs with the caller's rights: RLS and the closed-month guard both apply.
create function public.accept_receipt_item(
  item_id      uuid,
  villa_id     uuid,
  date         date,
  category_id  uuid,
  currency     char(3),
  amount       numeric,
  fx_rate      numeric,
  description  text default null,
  direction    public.tx_direction default 'out'
)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  item public.receipt_items;
  tx   uuid;
begin
  select * into item from public.receipt_items where id = item_id for update;
  if not found then
    raise exception 'Receipt item not found' using errcode = 'no_data_found';
  end if;
  if item.status <> 'pending' then
    raise exception 'Receipt item already %', item.status using errcode = 'check_violation';
  end if;

  insert into public.transactions
    (organization_id, villa_id, date, direction, category_id, description,
     currency, amount, fx_rate, status, source)
  values
    (item.organization_id, accept_receipt_item.villa_id, accept_receipt_item.date,
     accept_receipt_item.direction, accept_receipt_item.category_id,
     accept_receipt_item.description, accept_receipt_item.currency,
     accept_receipt_item.amount, accept_receipt_item.fx_rate, 'validated', 'receipt')
  returning id into tx;

  update public.evidence set transaction_id = tx where id = item.evidence_id;

  update public.receipt_items
  set status = 'accepted', transaction_id = tx, reviewed_by = auth.uid(), reviewed_at = now()
  where id = item_id;

  perform private.finish_batch_if_reviewed(item.batch_id);
  return tx;
end;
$$;

create function public.reject_receipt_item(item_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  batch uuid;
begin
  update public.receipt_items
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
  where id = item_id and status = 'pending'
  returning batch_id into batch;
  if batch is null then
    raise exception 'Receipt item not found or already reviewed' using errcode = 'no_data_found';
  end if;
  perform private.finish_batch_if_reviewed(batch);
end;
$$;

create function private.finish_batch_if_reviewed(batch uuid)
returns void
language sql security invoker set search_path = ''
as $$
  update public.receipt_batches b set status = 'done'
  where b.id = batch
    and b.status = 'to_review'
    and not exists (
      select 1 from public.receipt_items i where i.batch_id = batch and i.status = 'pending'
    )
$$;

grant execute on function private.finish_batch_if_reviewed(uuid) to authenticated;
revoke execute on function public.accept_receipt_item(uuid, uuid, date, uuid, char, numeric, numeric, text, public.tx_direction) from public, anon;
revoke execute on function public.reject_receipt_item(uuid) from public, anon;
grant execute on function public.accept_receipt_item(uuid, uuid, date, uuid, char, numeric, numeric, text, public.tx_direction) to authenticated;
grant execute on function public.reject_receipt_item(uuid) to authenticated;

-- Set by the engine once it has read the item (successfully or not); null = still to read.
alter table public.receipt_items add column read_at timestamptz;
create index receipt_items_unread on public.receipt_items (batch_id) where read_at is null;
