-- Bank actions as atomic functions (migration bank_agent): add, link, personal, put back; admins only; a line is
-- handled once; the trace of who handled it; a created entry deleted on undo only when that is safe.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin-a@test.local'),
  ('00000000-0000-0000-0000-0000000000a1', 'staff-a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'admin-b@test.local');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, service_role;
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u::text, true);
$$;
create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;
-- Runs a statement that must fail with a message starting with the given code.
create function pg_temp.fails(stmt text, code text, what text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAILED: % (no error)', what;
exception when others then
  if sqlerrm like 'FAILED:%' then raise; end if;
  if sqlerrm not like code || '%' then raise exception 'FAILED: % (got: %)', what, sqlerrm; end if;
  raise notice 'ok - %', what;
end $$;
create function pg_temp.id(key text) returns uuid language sql as $$ select v from ids where k = key $$;
create function pg_temp.line(fp text, dir public.tx_direction, amt numeric, cur char(3) default 'IDR', d date default '2026-10-03')
returns uuid language sql as $$
  insert into bank_lines (organization_id, account_id, statement_id, date, direction, amount, currency, description, fingerprint)
  values (pg_temp.id('org'), pg_temp.id('acct'), pg_temp.id('stmt'), d, dir, amt, cur, 'TRF ' || fp, fp) returning id;
$$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into ids select 'org', public.create_organization('Org A', 'IDR');
insert into memberships (organization_id, user_id, role) values (pg_temp.id('org'), '00000000-0000-0000-0000-0000000000a1', 'staff');
with v as (insert into villas (organization_id, name, currency) values (pg_temp.id('org'), 'Villa', 'IDR') returning id)
insert into ids select 'villa', id from v;
with v as (insert into villas (organization_id, name, currency) values (pg_temp.id('org'), 'Villa 2', 'IDR') returning id)
insert into ids select 'villa2', id from v;
insert into ids select 'expense', id from categories where organization_id = pg_temp.id('org') and kind = 'expense' limit 1;
insert into ids select 'income', id from categories where organization_id = pg_temp.id('org') and kind = 'income' limit 1;
with a as (insert into bank_accounts (organization_id, name, institution, currency, last4)
  values (pg_temp.id('org'), 'Danamon', 'danamon', 'IDR', '4821') returning id)
insert into ids select 'acct', id from a;
with s as (insert into bank_statements (organization_id, account_id, storage_path, mime_type)
  values (pg_temp.id('org'), pg_temp.id('acct'), pg_temp.id('org') || '/s.pdf', 'application/pdf') returning id)
insert into ids select 'stmt', id from s;

-- ------------------------------------------------------------------ add to the books
insert into ids values ('l1', pg_temp.line('fp1', 'out', 350000));
insert into ids select 'tx1', public.bank_line_book(pg_temp.id('l1'), pg_temp.id('villa'), pg_temp.id('expense'), ' Petrol ', null, 'agent', 'Kadek fuel');
select pg_temp.expect((select status = 'matched' and matched_by = 'created' and transaction_id = pg_temp.id('tx1')
  and handled_via = 'agent' and handled_note = 'Kadek fuel' and handled_by = '00000000-0000-0000-0000-00000000000a' and handled_at is not null
  from bank_lines where id = pg_temp.id('l1')), 'adding a line books an entry, links it and keeps who did it');
select pg_temp.expect((select amount = 350000 and direction = 'out' and date = '2026-10-03' and description = 'Petrol' and source = 'module' and status = 'validated'
  from transactions where id = pg_temp.id('tx1')), 'the entry has the line''s date, direction and amount');
select pg_temp.fails(format('select public.bank_line_book(%L, %L, null, null, null)', pg_temp.id('l1'), pg_temp.id('villa')),
  'already_handled', 'a line already handled cannot be added twice');
select pg_temp.expect((select count(*) from transactions) = 1, 'and no second entry was written');

insert into ids values ('l2', pg_temp.line('fp2', 'out', 100000));
select pg_temp.fails(format('select public.bank_line_book(%L, %L, %L, null, null)', pg_temp.id('l2'), pg_temp.id('villa'), pg_temp.id('income')),
  'invalid_category', 'an income category on money out is refused');
insert into ids values ('usd', pg_temp.line('fp-usd', 'out', 12.5, 'USD'));
select pg_temp.fails(format('select public.bank_line_book(%L, %L, null, null, null)', pg_temp.id('usd'), pg_temp.id('villa')),
  'fx_rate_required', 'a foreign-currency line needs a rate');
select public.bank_line_book(pg_temp.id('usd'), pg_temp.id('villa'), null, null, 16000);
select pg_temp.expect((select amount_reporting = 200000 from transactions t join bank_lines l on l.transaction_id = t.id where l.id = pg_temp.id('usd')),
  'with a rate, the entry is in the line''s currency and converted');
select pg_temp.fails(format('select public.bank_line_personal(%L, null, %L)', pg_temp.id('l2'), 'robot'), 'Unknown handler', 'an unknown handler is refused');

-- ------------------------------------------------------------------ link
with t as (insert into transactions (organization_id, villa_id, date, direction, currency, amount, status, description)
  values (pg_temp.id('org'), pg_temp.id('villa'), '2026-10-02', 'out', 'IDR', 100000, 'validated', 'Gas') returning id)
insert into ids select 'tx2', id from t;
select public.bank_line_link(pg_temp.id('l2'), pg_temp.id('tx2'), 'manual', 'app');
select pg_temp.expect((select status = 'matched' and matched_by = 'manual' and handled_via = 'app' from bank_lines where id = pg_temp.id('l2')),
  'a line links to an entry already in the books');
select pg_temp.fails(format('select public.bank_line_link(%L, %L, %L, %L, null, true)', pg_temp.id('l2'), pg_temp.id('tx2'), 'manual', 'agent'),
  'already_handled', 'the amount check runs after the line check');
insert into ids values ('l3', pg_temp.line('fp3', 'out', 100000));
with t as (insert into transactions (organization_id, villa_id, date, direction, currency, amount, status)
  values (pg_temp.id('org'), pg_temp.id('villa'), '2026-10-02', 'out', 'IDR', 103000, 'validated') returning id)
insert into ids select 'tx_fee', id from t;
select pg_temp.fails(format('select public.bank_line_link(%L, %L, %L, %L, null, true)', pg_temp.id('l3'), pg_temp.id('tx_fee'), 'manual', 'agent'),
  'amount_mismatch', 'an entry of another amount is refused when the same amount is required');
select pg_temp.expect((select status from bank_lines where id = pg_temp.id('l3')) = 'unmatched', 'and the line stays in the list');
select pg_temp.fails(format('select public.bank_line_link(%L, %L)', pg_temp.id('l3'), pg_temp.id('tx2')),
  'entry_taken', 'an entry linked to one line cannot be claimed by another');
insert into ids values ('in1', pg_temp.line('fp-in1', 'in', 100000));
with t as (insert into transactions (organization_id, villa_id, date, direction, currency, amount, status)
  values (pg_temp.id('org'), pg_temp.id('villa'), '2026-10-02', 'out', 'IDR', 100000, 'validated') returning id)
insert into ids select 'tx3', id from t;
select pg_temp.fails(format('select public.bank_line_link(%L, %L)', pg_temp.id('in1'), pg_temp.id('tx3')),
  'direction_mismatch', 'money in cannot link to an expense');
select pg_temp.fails(format('select public.bank_line_link(%L, %L)', pg_temp.id('l2'), pg_temp.id('tx3')),
  'already_handled', 'a line already linked cannot be linked again');

with st as (insert into stays (organization_id, villa_id, platform, external_ref, check_in, check_out, currency, gross_amount)
  values (pg_temp.id('org'), pg_temp.id('villa'), 'airbnb', 'HM1', '2026-10-01', '2026-10-03', 'IDR', 60000) returning id)
insert into ids select 'stay1', id from st;
with st as (insert into stays (organization_id, villa_id, platform, external_ref, check_in, check_out, currency, gross_amount)
  values (pg_temp.id('org'), pg_temp.id('villa'), 'airbnb', 'HM2', '2026-10-01', '2026-10-03', 'IDR', 40000) returning id)
insert into ids select 'stay2', id from st;
select pg_temp.fails(format('select public.bank_line_link_stays(%L, array[%L]::uuid[])', pg_temp.id('l3'), pg_temp.id('stay1')),
  'direction_mismatch', 'money out cannot pay a stay');
select pg_temp.fails(format('select public.bank_line_link_stays(%L, array[%L, %L]::uuid[])', pg_temp.id('in1'), pg_temp.id('stay1'), gen_random_uuid()),
  'not_found', 'an unknown stay is refused and nothing is linked');
select pg_temp.expect((select count(*) from bank_line_stays) = 0, 'and no stay was linked');
select public.bank_line_link_stays(pg_temp.id('in1'), array[pg_temp.id('stay1'), pg_temp.id('stay2')], 'manual', 'agent', 'Payout 2 stays');
select pg_temp.expect((select count(*) from bank_line_stays where line_id = pg_temp.id('in1')) = 2
  and (select status = 'matched' and handled_via = 'agent' from bank_lines where id = pg_temp.id('in1')), 'one payout links to several stays');

-- ------------------------------------------------------------------ personal
insert into ids values ('p1', pg_temp.line('fp-p1', 'out', 5000000));
select pg_temp.fails(format('select public.bank_line_personal(%L, %L, %L)', pg_temp.id('p1'), 'holiday', 'agent'), 'new row', 'an unknown personal reason is refused');
select public.bank_line_personal(pg_temp.id('p1'), 'owner_transfer', 'agent', 'To Pierre');
select pg_temp.expect((select status = 'personal' and personal_reason = 'owner_transfer' from bank_lines where id = pg_temp.id('p1')),
  'a line is marked personal with its reason');

-- ------------------------------------------------------------------ put back
select pg_temp.expect((select public.bank_line_reset(pg_temp.id('p1')) ->> 'was') = 'personal', 'a personal line is put back');
select pg_temp.expect((select status = 'unmatched' and personal_reason is null and handled_via is null from bank_lines where id = pg_temp.id('p1')),
  'putting a personal line back clears its reason and trace');
select pg_temp.fails(format('select public.bank_line_reset(%L)', pg_temp.id('p1')), 'not_handled', 'a line already in the list cannot be put back');

select pg_temp.expect((select (public.bank_line_reset(pg_temp.id('in1')) ->> 'entry_deleted')::boolean = false), 'a payout is unlinked from its stays');
select pg_temp.expect((select count(*) from bank_line_stays) = 0 and (select count(*) from stays) = 2, 'the stays themselves stay');

select pg_temp.fails(format('select public.bank_line_reset(%L, true)', pg_temp.id('l2')), 'cannot_delete', 'an entry that was only linked is never deleted');
select pg_temp.expect((select status from bank_lines where id = pg_temp.id('l2')) = 'matched', 'and the refused undo changed nothing');
select public.bank_line_reset(pg_temp.id('l2'));
select pg_temp.expect((select count(*) from transactions where id = pg_temp.id('tx2')) = 1, 'unlinking keeps the entry by default');

insert into evidence (organization_id, transaction_id, storage_path, mime_type)
values (pg_temp.id('org'), pg_temp.id('tx1'), pg_temp.id('org') || '/r.jpg', 'image/jpeg');
select pg_temp.fails(format('select public.bank_line_reset(%L, true)', pg_temp.id('l1')), 'cannot_delete', 'an entry with a receipt is not deleted on undo');
delete from evidence where transaction_id = pg_temp.id('tx1');

insert into month_closes (organization_id, villa_id, month, status, closed_at) values (pg_temp.id('org'), pg_temp.id('villa'), '2026-10-01', 'closed', now());
select pg_temp.fails(format('select public.bank_line_reset(%L, true)', pg_temp.id('l1')), 'Month', 'deleting an entry of a closed month is refused');
select pg_temp.expect((select status = 'matched' and transaction_id = pg_temp.id('tx1') from bank_lines where id = pg_temp.id('l1')),
  'and the line is left as it was');
insert into ids values ('late', pg_temp.line('fp-late', 'out', 1000));
select pg_temp.fails(format('select public.bank_line_book(%L, %L, null, null, null)', pg_temp.id('late'), pg_temp.id('villa')), 'Month', 'adding into a closed month is refused');
select pg_temp.expect((select status from bank_lines where id = pg_temp.id('late')) = 'unmatched', 'and the line stays in the list');
update month_closes set status = 'open', closed_at = null where villa_id = pg_temp.id('villa');

update transactions set amount = 360000 where id = pg_temp.id('tx1');
select pg_temp.fails(format('select public.bank_line_reset(%L, true)', pg_temp.id('l1')), 'cannot_delete', 'an entry edited since it was created is not deleted on undo');
update transactions set amount = 350000 where id = pg_temp.id('tx1');
select pg_temp.expect((select (public.bank_line_reset(pg_temp.id('l1'), true) ->> 'entry_deleted')::boolean), 'undo deletes the entry created from the line');
select pg_temp.expect((select count(*) from transactions where id = pg_temp.id('tx1')) = 0
  and (select status = 'unmatched' and transaction_id is null from bank_lines where id = pg_temp.id('l1')), 'the line is back in the list, the entry gone');

-- ------------------------------------------------------------------ several lines as one entry (bank charges)
insert into ids values ('c1', pg_temp.line('fp-c1', 'out', 7500)), ('c2', pg_temp.line('fp-c2', 'out', 2500));
insert into ids select 'tcharges', public.bank_lines_book_group(array[pg_temp.id('c1'), pg_temp.id('c2')], jsonb_build_array(
  jsonb_build_object('villa_id', pg_temp.id('villa'), 'date', '2026-10-31', 'direction', 'out', 'currency', 'IDR', 'amount', 5000, 'description', 'Bank fees (share 1/2)'),
  jsonb_build_object('villa_id', pg_temp.id('villa2'), 'date', '2026-10-31', 'direction', 'out', 'currency', 'IDR', 'amount', 5000, 'description', 'Bank fees (share 2/2)')), 'agent');
select pg_temp.expect((select count(distinct split_group) = 1 and count(*) = 2 from transactions where description like 'Bank fees%')
  and (select bool_and(transaction_id = pg_temp.id('tcharges') and handled_via = 'agent') from bank_lines where id in (pg_temp.id('c1'), pg_temp.id('c2'))),
  'a month''s charges: shares tied together, every line linked');
select pg_temp.fails(format('select public.bank_lines_book_group(array[%L]::uuid[], %L::jsonb)', pg_temp.id('c1'),
  jsonb_build_array(jsonb_build_object('villa_id', pg_temp.id('villa'), 'date', '2026-10-31', 'direction', 'out', 'currency', 'IDR', 'amount', 7500))),
  'already_handled', 'charges already booked are not booked again');
select pg_temp.expect((select count(*) from transactions where description like 'Bank fees%') = 2, 'and nothing more was written');
select pg_temp.fails(format('select public.bank_line_reset(%L, true)', pg_temp.id('c1')), 'cannot_delete', 'an entry covering several lines is not deleted on undo');

-- Deleting the entry from Transactions still puts its lines back, now without any trace.
delete from transactions where split_group is not null;
select pg_temp.expect((select bool_and(status = 'unmatched' and handled_via is null and handled_at is null) from bank_lines where id in (pg_temp.id('c1'), pg_temp.id('c2'))),
  'deleting the entry puts its lines back with no trace');

select pg_temp.fails(format('select public.bank_lines_book_group(array[%L]::uuid[], %L::jsonb)', pg_temp.id('c1'),
  jsonb_build_array(jsonb_build_object('villa_id', pg_temp.id('villa'), 'date', '2026-10-31', 'direction', 'out', 'currency', 'IDR', 'amount', 1))),
  'invalid_entries', 'grouped entries must come to the lines'' total');
select pg_temp.fails(format('select public.bank_lines_book_group(array[%L]::uuid[], %L::jsonb)', pg_temp.id('c1'),
  jsonb_build_array(jsonb_build_object('villa_id', pg_temp.id('villa'), 'date', '2026-10-31', 'direction', 'out', 'currency', 'USD', 'amount', 7500))),
  'invalid_entries', 'grouped entries must be in the lines'' currency');
select pg_temp.fails(format('select public.bank_lines_book_group(array[%L]::uuid[], %L::jsonb)', pg_temp.id('c1'),
  jsonb_build_array(jsonb_build_object('villa_id', pg_temp.id('villa'), 'date', '2026-10-31', 'direction', 'out', 'currency', 'IDR', 'amount', 7500,
    'category_id', pg_temp.id('income')))),
  'invalid_category', 'grouped entries need categories of the right kind');

-- ------------------------------------------------------------------ the server (daily Gmail check) matching on its own
insert into ids values ('srv', pg_temp.line('fp-srv', 'out', 42000));
with t as (insert into transactions (organization_id, villa_id, date, direction, currency, amount, status)
  values (pg_temp.id('org'), pg_temp.id('villa'), '2026-10-03', 'out', 'IDR', 42000, 'validated') returning id)
insert into ids select 'tx_srv', id from t;
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;
select public.bank_line_link(pg_temp.id('srv'), pg_temp.id('tx_srv'), 'auto', 'auto');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select status = 'matched' and matched_by = 'auto' and handled_via = 'auto' and handled_by is null from bank_lines where id = pg_temp.id('srv')),
  'the server links a line with no user signed in');

-- ------------------------------------------------------------------ who may
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.fails(format('select public.bank_line_personal(%L)', pg_temp.id('l3')), 'not_found', 'staff cannot handle a bank line');
select pg_temp.fails(format('select public.bank_line_reset(%L)', pg_temp.id('usd')), 'not_found', 'staff cannot put a line back');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into ids select 'orgb', public.create_organization('Org B', 'IDR');
with v as (insert into villas (organization_id, name, currency) values (pg_temp.id('orgb'), 'B', 'IDR') returning id)
insert into ids select 'villab', id from v;
select pg_temp.fails(format('select public.bank_line_book(%L, %L, null, null, null)', pg_temp.id('l3'), pg_temp.id('villab')),
  'not_found', 'another organization cannot book a line');
select pg_temp.expect((select count(*) from bank_lines) = 0, 'and sees none');

insert into ids select 'catb', id from categories where organization_id = pg_temp.id('orgb') and kind = 'expense' limit 1;
with t as (insert into transactions (organization_id, villa_id, date, direction, currency, amount, status)
  values (pg_temp.id('orgb'), pg_temp.id('villab'), '2026-10-03', 'out', 'IDR', 100000, 'validated') returning id)
insert into ids select 'txb', id from t;
with st as (insert into stays (organization_id, villa_id, platform, external_ref, check_in, check_out, currency, gross_amount)
  values (pg_temp.id('orgb'), pg_temp.id('villab'), 'airbnb', 'HMB', '2026-10-01', '2026-10-03', 'IDR', 100000) returning id)
insert into ids select 'stayb', id from st;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.fails(format('select public.bank_line_book(%L, %L, null, null, null)', pg_temp.id('l3'), pg_temp.id('villab')),
  '', 'an admin cannot book a line onto another organization''s villa');
select pg_temp.fails(format('select public.bank_line_book(%L, %L, %L, null, null)', pg_temp.id('l3'), pg_temp.id('villa'), pg_temp.id('catb')),
  'invalid_category', 'nor with another organization''s category');
select pg_temp.fails(format('select public.bank_line_link(%L, %L)', pg_temp.id('l3'), pg_temp.id('txb')),
  'not_found', 'nor link it to another organization''s entry');
insert into ids values ('in2', pg_temp.line('fp-in2', 'in', 100000));
select pg_temp.fails(format('select public.bank_line_link_stays(%L, array[%L]::uuid[])', pg_temp.id('in2'), pg_temp.id('stayb')),
  'not_found', 'nor to another organization''s stay');
select pg_temp.expect((select status from bank_lines where id = pg_temp.id('l3')) = 'unmatched', 'and the line stays in the list');

rollback;
