-- Part payments (migration bank_part_payments): several bank lines pay one entry, only when asked, never more than it.

begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'admin-a@test.local'),
  ('00000000-0000-0000-0000-0000000000a1', 'staff-a@test.local'), ('00000000-0000-0000-0000-00000000000b', 'admin-b@test.local');

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
create function pg_temp.line(fp text, amt numeric, cur char(3) default 'IDR') returns uuid language sql as $$
  insert into bank_lines (organization_id, account_id, statement_id, date, direction, amount, currency, description, fingerprint)
  values (pg_temp.id('org'), pg_temp.id('acct'), pg_temp.id('stmt'), '2025-05-20', 'out', amt, cur, 'TRF ' || fp, fp) returning id;
$$;
create function pg_temp.entry(amt numeric, cur char(3) default 'IDR', fx numeric default 1) returns uuid language sql as $$
  insert into transactions (organization_id, villa_id, date, direction, currency, amount, fx_rate, status, description)
  values (pg_temp.id('org'), pg_temp.id('villa'), '2025-05-01', 'out', cur, amt, fx, 'validated', 'Furnitures/ general') returning id;
$$;
create function pg_temp.status(key text) returns text language sql as $$ select status::text from bank_lines where id = pg_temp.id(key) $$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into ids select 'org', public.create_organization('Org A', 'IDR');
with v as (insert into villas (organization_id, name, currency) values (pg_temp.id('org'), 'Villa', 'IDR') returning id)
insert into ids select 'villa', id from v;
with a as (insert into bank_accounts (organization_id, name, institution, currency, last4)
  values (pg_temp.id('org'), 'Danamon', 'danamon', 'IDR', '4821') returning id)
insert into ids select 'acct', id from a;
with s as (insert into bank_statements (organization_id, account_id, storage_path, mime_type)
  values (pg_temp.id('org'), pg_temp.id('acct'), pg_temp.id('org') || '/s.pdf', 'application/pdf') returning id)
insert into ids select 'stmt', id from s;

-- ------------------------------------------------------------------ one entry, several payments
insert into ids values ('tx', pg_temp.entry(1000000));
insert into ids values ('a', pg_temp.line('a', 300000)), ('b', pg_temp.line('b', 250000)), ('c', pg_temp.line('c', 450000)),
  ('d', pg_temp.line('d', 1));

select public.bank_line_link(pg_temp.id('a'), pg_temp.id('tx'));
select pg_temp.expect(pg_temp.status('a') = 'matched', 'a first line links to the entry as before (its amount may differ)');
select pg_temp.fails(format('select public.bank_line_link(%L, %L)', pg_temp.id('b'), pg_temp.id('tx')),
  'entry_taken', 'without asking for a part payment, an entry already linked stays taken');
select pg_temp.fails(format('select public.bank_line_link(%L, %L, p_same_amount => true)', pg_temp.id('b'), pg_temp.id('tx')),
  'entry_taken', 'nor with the same-amount check');
select public.bank_line_link(pg_temp.id('b'), pg_temp.id('tx'), p_part => true, p_note => 'Rosita');
select pg_temp.expect((select status = 'matched' and transaction_id = pg_temp.id('tx') and handled_note = 'Rosita'
  from bank_lines where id = pg_temp.id('b')), 'as a part payment, a second line joins the entry');
select public.bank_line_link(pg_temp.id('c'), pg_temp.id('tx'), p_part => true);
select pg_temp.expect((select count(*) from bank_lines where transaction_id = pg_temp.id('tx')) = 3,
  'a third one pays exactly what is left');
select pg_temp.fails(format('select public.bank_line_link(%L, %L, p_part => true)', pg_temp.id('d'), pg_temp.id('tx')),
  'entry_taken', 'once the entry is paid in full, not one rupiah more');
select pg_temp.expect(pg_temp.status('d') = 'unmatched', 'and the refused line stays in the list');

-- Undoing one payment leaves the others, and the entry, in place; its room comes back.
select public.bank_line_reset(pg_temp.id('c'));
select pg_temp.expect((select count(*) from bank_lines where transaction_id = pg_temp.id('tx')) = 2
  and exists (select 1 from transactions where id = pg_temp.id('tx')), 'putting one payment back keeps the others and the entry');
select public.bank_line_link(pg_temp.id('d'), pg_temp.id('tx'), p_part => true);
select pg_temp.expect(pg_temp.status('d') = 'matched', 'and what it paid can be paid by another line');

-- A part may be asked for the first line too: it links, but never for more than the whole entry.
insert into ids values ('tx_small', pg_temp.entry(100000)), ('big', pg_temp.line('big', 103000)), ('first', pg_temp.line('first', 40000));
select pg_temp.fails(format('select public.bank_line_link(%L, %L, p_part => true)', pg_temp.id('big'), pg_temp.id('tx_small')),
  'amount_mismatch', 'a first part payment larger than the whole entry is refused');
select public.bank_line_link(pg_temp.id('big'), pg_temp.id('tx_small'));
select pg_temp.expect(pg_temp.status('big') = 'matched', 'linked as a whole, its amount may still differ (as before)');
insert into ids values ('tx_first', pg_temp.entry(100000));
select public.bank_line_link(pg_temp.id('first'), pg_temp.id('tx_first'), p_part => true);
select pg_temp.expect(pg_temp.status('first') = 'matched', 'a first part payment within the entry links');

-- ------------------------------------------------------------------ currencies
-- An entry in USD, converted to the reporting currency (IDR): IDR lines are added up against its converted value.
insert into ids values ('tx_usd', pg_temp.entry(100, 'USD', 16000));
insert into ids values ('i1', pg_temp.line('i1', 800000)), ('i2', pg_temp.line('i2', 800000)), ('i3', pg_temp.line('i3', 1000));
select public.bank_line_link(pg_temp.id('i1'), pg_temp.id('tx_usd'));
select public.bank_line_link(pg_temp.id('i2'), pg_temp.id('tx_usd'), p_part => true);
select pg_temp.expect(pg_temp.status('i2') = 'matched', 'lines in the reporting currency add up against the converted entry');
select pg_temp.fails(format('select public.bank_line_link(%L, %L, p_part => true)', pg_temp.id('i3'), pg_temp.id('tx_usd')),
  'entry_taken', 'and never beyond it');
-- A line in a third currency cannot be added up with them.
insert into ids values ('eur', pg_temp.line('eur', 10, 'EUR'));
select pg_temp.fails(format('select public.bank_line_link(%L, %L, p_part => true)', pg_temp.id('eur'), pg_temp.id('tx')),
  'amount_mismatch', 'a line in a currency the entry cannot be compared with is refused as a part');

-- In one currency, to the cent; a mix of the entry's currency and converted amounts, within 0.01% (rounding).
insert into ids values ('tx_r', pg_temp.entry(1000000)), ('r1', pg_temp.line('r1', 999999.99)), ('r2', pg_temp.line('r2', 0.02)),
  ('r3', pg_temp.line('r3', 500000)), ('r4', pg_temp.line('r4', 0.01));
select public.bank_line_link(pg_temp.id('r1'), pg_temp.id('tx_r'));
select pg_temp.fails(format('select public.bank_line_link(%L, %L, p_part => true)', pg_temp.id('r2'), pg_temp.id('tx_r')),
  'entry_taken', 'in one currency, a cent over the entry is refused');
select public.bank_line_link(pg_temp.id('r4'), pg_temp.id('tx_r'), p_part => true);
select pg_temp.expect(pg_temp.status('r4') = 'matched', 'and the last cent is accepted');
insert into ids values ('tx_mix', pg_temp.entry(100, 'USD', 16000)), ('m1', pg_temp.line('m1', 50, 'USD')),
  ('m2', pg_temp.line('m2', 800100)), ('m3', pg_temp.line('m3', 801000));
select public.bank_line_link(pg_temp.id('m1'), pg_temp.id('tx_mix'));
select pg_temp.fails(format('select public.bank_line_link(%L, %L, p_part => true)', pg_temp.id('m3'), pg_temp.id('tx_mix')),
  'entry_taken', 'mixing currencies, more than 0.01% over the entry is refused');
select public.bank_line_link(pg_temp.id('m2'), pg_temp.id('tx_mix'), p_part => true);
select pg_temp.expect(pg_temp.status('m2') = 'matched', 'mixing currencies, within 0.01% over the entry is accepted');

-- Bank charges booked together already pay their entry in full: no other line can join it.
insert into ids values ('f1', pg_temp.line('f1', 15000)), ('f2', pg_temp.line('f2', 5000));
insert into ids select 'tx_fees', public.bank_lines_book_group(array[pg_temp.id('f1'), pg_temp.id('f2')],
  jsonb_build_array(jsonb_build_object('villa_id', pg_temp.id('villa'), 'date', '2025-05-31', 'direction', 'out', 'category_id', null,
    'description', 'Bank charges', 'currency', 'IDR', 'amount', 20000, 'fx_rate', 1)), 'app', null);
select pg_temp.fails(format('select public.bank_line_link(%L, %L, p_part => true)', pg_temp.id('r3'), pg_temp.id('tx_fees')),
  'entry_taken', 'an entry its bank charges pay in full takes no other line');

-- ------------------------------------------------------------------ who may
insert into memberships (organization_id, user_id, role) values (pg_temp.id('org'), '00000000-0000-0000-0000-0000000000a1', 'staff');
insert into ids values ('tx_open', pg_temp.entry(1000000)), ('o1', pg_temp.line('o1', 100000)), ('o2', pg_temp.line('o2', 100000));
select public.bank_line_link(pg_temp.id('o1'), pg_temp.id('tx_open'));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.fails(format('select public.bank_line_link(%L, %L, p_part => true)', pg_temp.id('o2'), pg_temp.id('tx_open')),
  'not_found', 'staff cannot link a part payment');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into ids select 'org_b', public.create_organization('Org B', 'IDR');
with a as (insert into bank_accounts (organization_id, name, institution, currency) values (pg_temp.id('org_b'), 'Danamon', 'danamon', 'IDR') returning id)
insert into ids select 'acct_b', id from a;
with s as (insert into bank_statements (organization_id, account_id, storage_path, mime_type)
  values (pg_temp.id('org_b'), pg_temp.id('acct_b'), pg_temp.id('org_b') || '/s.pdf', 'application/pdf') returning id)
insert into ids select 'stmt_b', id from s;
with l as (insert into bank_lines (organization_id, account_id, statement_id, date, direction, amount, currency, description, fingerprint)
  values (pg_temp.id('org_b'), pg_temp.id('acct_b'), pg_temp.id('stmt_b'), '2025-05-20', 'out', 100000, 'IDR', 'TRF b', 'b1') returning id)
insert into ids select 'line_b', id from l;
select pg_temp.fails(format('select public.bank_line_link(%L, %L, p_part => true)', pg_temp.id('line_b'), pg_temp.id('tx_open')),
  'not_found', 'another organization cannot make its line a payment of this entry');
select pg_temp.fails(format('select public.bank_line_link(%L, %L, p_part => true)', pg_temp.id('o2'), pg_temp.id('tx_open')),
  'not_found', 'nor link this organization''s line');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from bank_lines where transaction_id = pg_temp.id('tx_open')) = 1, 'and the entry kept its one payment');

rollback;
