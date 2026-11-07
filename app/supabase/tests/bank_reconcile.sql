-- Reconciliation v2 (migration bank_reconcile): the owner's note, lines that cancel out, several lines for one entry.

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
create function pg_temp.line(fp text, dir text, amt numeric, cur char(3) default 'IDR') returns uuid language sql as $$
  insert into bank_lines (organization_id, account_id, statement_id, date, direction, amount, currency, description, fingerprint)
  values (pg_temp.id('org'), pg_temp.id('acct'), pg_temp.id('stmt'), '2026-06-26', dir::tx_direction, amt, cur, 'PCM ' || fp, fp) returning id;
$$;
create function pg_temp.entry(amt numeric, cur char(3) default 'IDR', fx numeric default 1) returns uuid language sql as $$
  insert into transactions (organization_id, villa_id, date, direction, currency, amount, fx_rate, status, description)
  values (pg_temp.id('org'), pg_temp.id('villa'), '2026-06-25', 'out', cur, amt, fx, 'validated', 'Shower head') returning id;
$$;
create function pg_temp.status(key text) returns text language sql as $$ select status::text from bank_lines where id = pg_temp.id(key) $$;
create function pg_temp.ids(variadic keys text[]) returns uuid[] language sql as $$ select array_agg(pg_temp.id(k)) from unnest(keys) k $$;

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

-- ------------------------------------------------------------------ the owner's note
insert into ids values ('n', pg_temp.line('n', 'out', 820500));
update bank_lines set note = 'Kadek, receipts of late May' where id = pg_temp.id('n');
select pg_temp.expect((select note from bank_lines where id = pg_temp.id('n')) = 'Kadek, receipts of late May',
  'an admin writes a note on a line still to do');
select public.bank_line_personal(pg_temp.id('n'), 'private_expense');
select public.bank_line_reset(pg_temp.id('n'));
select pg_temp.expect((select note is not null and handled_note is null from bank_lines where id = pg_temp.id('n')),
  'the note stays when the line is handled and put back');

-- ------------------------------------------------------------------ lines that cancel out
insert into ids values ('sent', pg_temp.line('sent', 'out', 2250000)), ('back', pg_temp.line('back', 'in', 2250000)),
  ('other', pg_temp.line('other', 'in', 2240000)), ('also_out', pg_temp.line('also_out', 'out', 10000));
select pg_temp.fails(format('select public.bank_lines_cancel(%L)', pg_temp.ids('sent', 'other')),
  'amount_mismatch', 'lines that do not come to zero are refused');
select pg_temp.fails(format('select public.bank_lines_cancel(%L)', pg_temp.ids('sent', 'also_out')),
  'direction_mismatch', 'two lines out never cancel out');
select pg_temp.fails(format('select public.bank_lines_cancel(%L)', pg_temp.ids('sent')),
  'not_found', 'one line alone is refused');
select pg_temp.expect(pg_temp.status('sent') = 'unmatched', 'and a refused call changes nothing');
select public.bank_lines_cancel(pg_temp.ids('sent', 'back'), 'app', 'Sent back by the bank, paid again on 30 Jun');
select pg_temp.expect((select bool_and(status = 'personal' and personal_reason = 'returned' and handled_note like 'Sent back%')
  from bank_lines where id = any (pg_temp.ids('sent', 'back'))), 'money out and the same money back are set aside together');
select pg_temp.fails(format('select public.bank_lines_cancel(%L)', pg_temp.ids('back', 'other')),
  'already_handled', 'a line already set aside cannot cancel another one');
-- With the fee Wise refunded too: out 3,196,800 + fee 12,804, back 3,209,604.
insert into ids values ('w', pg_temp.line('w', 'out', 3196800)), ('wf', pg_temp.line('wf', 'out', 12804)), ('wb', pg_temp.line('wb', 'in', 3209604));
select public.bank_lines_cancel(pg_temp.ids('w', 'wf', 'wb'));
select pg_temp.expect(pg_temp.status('wf') = 'personal', 'a transfer, its fee and the refund of both cancel out');

select pg_temp.fails(format('select public.bank_line_personal(%L, %L)', pg_temp.id('other'), 'returned'),
  'invalid_entries', '"returned" is never given to one line alone');
with a as (insert into bank_accounts (organization_id, name, institution, currency) values (pg_temp.id('org'), 'Wise', 'wise', 'IDR') returning id)
insert into ids select 'acct2', id from a;
insert into ids values ('z_out', pg_temp.line('z_out', 'out', 300000));
with l as (insert into bank_lines (organization_id, account_id, statement_id, date, direction, amount, currency, description, fingerprint)
  values (pg_temp.id('org'), pg_temp.id('acct2'), pg_temp.id('stmt'), '2026-06-27', 'in', 300000, 'IDR', 'Top-up', 'z_in') returning id)
insert into ids select 'z_in', id from l;
select pg_temp.fails(format('select public.bank_lines_cancel(%L)', pg_temp.ids('z_out', 'z_in')),
  'invalid_entries', 'lines of two accounts do not cancel out: that is a move between own accounts');

-- ------------------------------------------------------------------ several lines, one entry
insert into ids values ('tx', pg_temp.entry(227804)), ('pay', pg_temp.line('pay', 'out', 215000)), ('fee', pg_temp.line('fee', 'out', 12804)),
  ('fee2', pg_temp.line('fee2', 'out', 12805)), ('in1', pg_temp.line('in1', 'in', 12804));
select pg_temp.fails(format('select public.bank_lines_link_entry(%L, %L)', pg_temp.ids('pay', 'fee2'), pg_temp.id('tx')),
  'amount_mismatch', 'lines one rupiah off the entry are refused');
select pg_temp.fails(format('select public.bank_lines_link_entry(%L, %L)', pg_temp.ids('pay', 'in1'), pg_temp.id('tx')),
  'direction_mismatch', 'money in cannot pay an expense');
select public.bank_lines_link_entry(pg_temp.ids('pay', 'fee'), pg_temp.id('tx'), 'auto', 'auto');
select pg_temp.expect((select bool_and(status = 'matched' and transaction_id = pg_temp.id('tx') and matched_by = 'auto')
  from bank_lines where id = any (pg_temp.ids('pay', 'fee'))), 'a transfer and its fee are linked to the receipt''s total');
insert into ids values ('pay2', pg_temp.line('pay2', 'out', 215000)), ('fee3', pg_temp.line('fee3', 'out', 12804));
select pg_temp.fails(format('select public.bank_lines_link_entry(%L, %L)', pg_temp.ids('pay2', 'fee3'), pg_temp.id('tx')),
  'entry_taken', 'an entry already paid takes no other lines');
-- Converted: an entry in USD, lines in the reporting currency, within 0.01%.
insert into ids values ('tx_usd', pg_temp.entry(10, 'USD', 16000)), ('u1', pg_temp.line('u1', 'out', 150000)), ('u2', pg_temp.line('u2', 'out', 10000));
select public.bank_lines_link_entry(pg_temp.ids('u1', 'u2'), pg_temp.id('tx_usd'));
select pg_temp.expect(pg_temp.status('u2') = 'matched', 'lines in the reporting currency against a converted entry');

-- ------------------------------------------------------------------ Sply proposes a set that cancels out
insert into ids values ('x_out', pg_temp.line('x_out', 'out', 900000)), ('x_in', pg_temp.line('x_in', 'in', 900000)),
  ('y_out', pg_temp.line('y_out', 'out', 700000)), ('y_in', pg_temp.line('y_in', 'in', 700000));
insert into ids select 'run', public.bank_run_start(pg_temp.id('org'), null, 'app', 4, null);
create function pg_temp.propose(line text, a text, b text) returns uuid language sql as $$
  select public.bank_proposal_add(pg_temp.id('run'), jsonb_build_object('line_id', pg_temp.id(line)::text, 'action', 'personal',
    'personal_reason', 'returned', 'line_ids', jsonb_build_array(pg_temp.id(a)::text, pg_temp.id(b)::text), 'confidence', 'medium', 'why', 'w'));
$$;
select pg_temp.fails(format($q$select public.bank_proposal_add(%L, jsonb_build_object('line_id', %L::text, 'action', 'personal',
  'personal_reason', 'returned', 'confidence', 'medium', 'why', 'w'))$q$, pg_temp.id('run'), pg_temp.id('x_out')),
  'new row', 'a "returned" proposal must carry its set');
select pg_temp.fails(format('select pg_temp.propose(%L, %L, %L)', 'x_out', 'y_out', 'y_in'), 'not_found', 'a set must include its own line');
insert into ids values ('px_out', pg_temp.propose('x_out', 'x_out', 'x_in')), ('px_in', pg_temp.propose('x_in', 'x_out', 'x_in')),
  ('py_out', pg_temp.propose('y_out', 'y_out', 'y_in')), ('py_in', pg_temp.propose('y_in', 'y_out', 'y_in'));
-- Accepting one: the app claims it, sets the whole set aside; the other proposal of the set goes stale by itself.
select (public.bank_proposal_claim(pg_temp.id('px_out'), 'accepted')).id;
select public.bank_lines_cancel((select line_ids from bank_proposals where id = pg_temp.id('px_out')), 'agent', 'Proposed by Sply');
select pg_temp.expect(pg_temp.status('x_in') = 'personal' and (select status from bank_proposals where id = pg_temp.id('px_in')) = 'stale',
  'accepting one proposal of a set sets the whole set aside, and its other proposal goes stale');
-- Declining one declines the set.
select (public.bank_proposal_claim(pg_temp.id('py_out'), 'rejected')).id;
select public.bank_proposal_set_rejected(pg_temp.id('py_out'));
select pg_temp.expect((select status from bank_proposals where id = pg_temp.id('py_in')) = 'rejected'
  and pg_temp.status('y_in') = 'unmatched', 'declining one declines the set, and the lines stay to do');
select public.bank_run_finish(pg_temp.id('run'), 4, null, null, null);

-- ------------------------------------------------------------------ who may
insert into memberships (organization_id, user_id, role) values (pg_temp.id('org'), '00000000-0000-0000-0000-0000000000a1', 'staff');
insert into ids values ('s1', pg_temp.line('s1', 'out', 5000)), ('s2', pg_temp.line('s2', 'in', 5000));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.fails(format('select public.bank_lines_cancel(%L)', pg_temp.ids('s1', 's2')), 'not_found', 'staff cannot set lines aside');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.fails(format('select public.bank_lines_cancel(%L)', pg_temp.ids('s1', 's2')), 'not_found', 'nor another organization');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect(pg_temp.status('s1') = 'unmatched', 'and the lines are still to do');

rollback;
