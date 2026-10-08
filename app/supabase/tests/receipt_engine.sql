-- Receipt engine: storage access, review RPCs, closed months.
-- Same conventions as rls_smoke.sql: superuser, one transaction, rolled back.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin-a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'admin-b@test.local'),
  ('00000000-0000-0000-0000-0000000000a1', 'staff-a@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'owner-a1@test.local');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u::text, true);
$$;
create function pg_temp.id(key text) returns uuid language sql as $$ select v from ids where k = key $$;
create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;

set local role authenticated;

-- Setup: org A with one villa, a staff member and an owner viewer; org B empty.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into ids select 'orgB', public.create_organization('Org B');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into ids select 'orgA', public.create_organization('Org A');
with x as (insert into villas (organization_id, name, currency) select pg_temp.id('orgA'), 'Villa One', 'IDR' returning id)
  insert into ids select 'villa1', id from x;
with x as (insert into owners (organization_id, name) select pg_temp.id('orgA'), 'Owner One' returning id)
  insert into ids select 'owner1', id from x;
insert into villa_ownerships (organization_id, villa_id, owner_id, share_pct)
  values (pg_temp.id('orgA'), pg_temp.id('villa1'), pg_temp.id('owner1'), 100);
insert into memberships (organization_id, user_id, role, owner_id) values
  (pg_temp.id('orgA'), '00000000-0000-0000-0000-0000000000a1', 'staff', null),
  (pg_temp.id('orgA'), '00000000-0000-0000-0000-0000000000a2', 'owner_viewer', pg_temp.id('owner1'));

-- Staff uploads two receipts --------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');

insert into storage.objects (bucket_id, name) values
  ('evidence', pg_temp.id('orgA') || '/r1.jpg'),
  ('evidence', pg_temp.id('orgA') || '/r2.jpg');
select pg_temp.expect(true, 'staff can upload into their organization folder');

do $$ begin
  insert into storage.objects (bucket_id, name) values ('evidence', pg_temp.id('orgB') || '/x.jpg');
  raise exception 'FAILED: staff uploaded into another organization';
exception when insufficient_privilege then raise notice 'ok - staff cannot upload into another organization';
end $$;

with x as (insert into receipt_batches (organization_id, villa_id) select pg_temp.id('orgA'), pg_temp.id('villa1') returning id)
  insert into ids select 'batch', id from x;
with x as (insert into evidence (organization_id, storage_path, mime_type)
           select pg_temp.id('orgA'), pg_temp.id('orgA') || '/r1.jpg', 'image/jpeg' returning id)
  insert into ids select 'ev1', id from x;
with x as (insert into evidence (organization_id, storage_path, mime_type)
           select pg_temp.id('orgA'), pg_temp.id('orgA') || '/r2.jpg', 'image/jpeg' returning id)
  insert into ids select 'ev2', id from x;
with x as (insert into receipt_items (organization_id, batch_id, evidence_id)
           select pg_temp.id('orgA'), pg_temp.id('batch'), pg_temp.id('ev1') returning id)
  insert into ids select 'item1', id from x;
with x as (insert into receipt_items (organization_id, batch_id, evidence_id)
           select pg_temp.id('orgA'), pg_temp.id('batch'), pg_temp.id('ev2') returning id)
  insert into ids select 'item2', id from x;

select pg_temp.expect((select count(*) from receipt_items where read_at is null) = 2, 'two items waiting for the engine');

-- What the Edge Function does, as the same user.
update receipt_items set proposed = '{"total": 150000, "currency": "IDR"}', read_at = now()
  where batch_id = pg_temp.id('batch');
update receipt_batches set status = 'to_review' where id = pg_temp.id('batch');

-- Owner viewer before acceptance ------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect((select count(*) from storage.objects) = 0, 'owner cannot open receipts not yet in the books');
select pg_temp.expect((select count(*) from receipt_items) = 0, 'owner cannot see the review queue');

-- Other tenant -------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from storage.objects) = 0, 'admin B cannot list org A files');
do $$ begin
  perform public.accept_receipt_item(pg_temp.id('item1'), pg_temp.id('villa1'), '2026-09-14',
    null, 'IDR', 150000, 0.0000625);
  raise exception 'FAILED: admin B accepted an org A item';
exception when no_data_found then raise notice 'ok - admin B cannot accept org A items';
end $$;

-- Review by staff ----------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'tx1', public.accept_receipt_item(
  pg_temp.id('item1'), pg_temp.id('villa1'), '2026-09-14',
  (select id from categories where name = 'Pool & garden'), 'IDR', 150000, 0.0000625, 'Pool chlorine');

select pg_temp.expect(
  (select status = 'validated' and source = 'receipt' and amount_reporting = 9.38 from transactions where id = pg_temp.id('tx1')),
  'accepted item becomes a validated receipt transaction (150000 IDR = 9.38 USD)');
select pg_temp.expect((select transaction_id from evidence where id = pg_temp.id('ev1')) = pg_temp.id('tx1'),
  'evidence attached to the new transaction');
select pg_temp.expect((select status from receipt_batches where id = pg_temp.id('batch')) = 'to_review',
  'batch stays in review while an item is pending');

do $$ begin
  perform public.accept_receipt_item(pg_temp.id('item1'), pg_temp.id('villa1'), '2026-09-14',
    null, 'IDR', 150000, 0.0000625);
  raise exception 'FAILED: accepted the same item twice';
exception when check_violation then raise notice 'ok - an item cannot be accepted twice';
end $$;

select public.reject_receipt_item(pg_temp.id('item2'));
select pg_temp.expect((select status from receipt_batches where id = pg_temp.id('batch')) = 'done',
  'batch done once every item is reviewed');
select pg_temp.expect((select count(*) from transactions) = 1, 'rejected item created no transaction');

-- Owner viewer after acceptance -------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect((select count(*) from storage.objects) = 1
  and (select name from storage.objects) like '%/r1.jpg',
  'owner can open the receipt behind a validated transaction, and only that one');

-- Closed month ---------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into month_closes (organization_id, villa_id, month, status, closed_by, closed_at)
  values (pg_temp.id('orgA'), pg_temp.id('villa1'), '2026-08-01', 'closed', auth.uid(), now());
with x as (insert into evidence (organization_id, storage_path, mime_type)
           select pg_temp.id('orgA'), pg_temp.id('orgA') || '/r3.jpg', 'image/jpeg' returning id)
  insert into ids select 'ev3', id from x;
with x as (insert into receipt_items (organization_id, batch_id, evidence_id)
           select pg_temp.id('orgA'), pg_temp.id('batch'), pg_temp.id('ev3') returning id)
  insert into ids select 'item3', id from x;
do $$ begin
  perform public.accept_receipt_item(pg_temp.id('item3'), pg_temp.id('villa1'), '2026-08-20',
    null, 'IDR', 50000, 0.0000625);
  raise exception 'FAILED: accepted a receipt into a closed month';
exception when check_violation then raise notice 'ok - a receipt cannot land in a closed month';
end $$;
select pg_temp.expect((select status from receipt_items where id = pg_temp.id('item3')) = 'pending',
  'item stays pending after the refused acceptance');

rollback;
