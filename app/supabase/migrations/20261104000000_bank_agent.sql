-- Splyce — bank lines handled by the assistant (MCP and chat), and one atomic operation per action.
--
-- Each action on a bank line (add to the books, link, personal, put back) is one function: it locks the line, checks
-- it is still to do, and writes. The app, the assistant and the automatic matching all go through them, so two of
-- them acting on the same line at once can never book it twice; the second one gets "already_handled".
--
-- Errors are raised with a message that starts with a code the callers read: not_found, already_handled,
-- not_handled, direction_mismatch, entry_taken, stay_entry, amount_mismatch, invalid_category, invalid_entries,
-- fx_rate_required, cannot_delete.
-- A closed month keeps its own message (guard_closed_month) and rolls the whole action back.

alter table public.bank_lines
  add column handled_via text check (handled_via in ('auto', 'app', 'agent')),
  add column handled_by uuid references auth.users(id) on delete set null,
  add column handled_at timestamptz,
  add column handled_note text check (char_length(handled_note) <= 500),
  add column personal_reason text
    check (personal_reason in ('owner_transfer', 'owner_contribution', 'private_expense', 'internal_transfer'));

-- Lines handled before this migration keep no trace (null): matched_by already tells the automatic ones apart.
-- No backfill, so the app still running the previous code can put any line back until it is redeployed.

-- A line in the list carries no trace of an earlier handling; only a personal line has a reason.
alter table public.bank_lines
  add constraint bank_lines_unhandled_clean
    check (status <> 'unmatched' or (handled_via is null and handled_by is null and handled_at is null and handled_note is null)),
  add constraint bank_lines_personal_reason check (personal_reason is null or status = 'personal');

-- The two ways a line goes back to the list by itself (its entry or its last stay deleted) now clear the trace too.
create or replace function private.bank_line_stay_unlinked() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.bank_lines l set status = 'unmatched', matched_by = null,
    handled_via = null, handled_by = null, handled_at = null, handled_note = null
  where l.id = old.line_id and l.status = 'matched' and l.transaction_id is null
    and not exists (select 1 from public.bank_line_stays x where x.line_id = old.line_id);
  return null;
end $$;

create or replace function private.bank_line_unlinked() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.transaction_id is null and old.transaction_id is not null and new.status = 'matched' then
    new.status := 'unmatched';
    new.matched_by := null;
    new.handled_via := null; new.handled_by := null; new.handled_at := null; new.handled_note := null;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------------------

-- The line, locked until the end of the caller's transaction. RLS hides lines from non-admins: they get not_found.
create function private.bank_line_lock(p_line uuid, p_want public.bank_line_status default 'unmatched')
returns public.bank_lines
language plpgsql security invoker set search_path = '' as $$
declare
  l public.bank_lines;
begin
  select * into l from public.bank_lines where id = p_line for update;
  -- The server itself (service_role: the daily Gmail check matching payouts) acts for no user; no signed-in user
  -- can take that role.
  if not found or not (current_user = 'service_role' or private.is_admin(l.organization_id)) then
    raise exception 'not_found: No bank line with that id.';
  end if;
  if p_want = 'unmatched' and l.status <> 'unmatched' then
    raise exception 'already_handled: This line was already handled (%).', l.status;
  end if;
  if p_want is null and l.status = 'unmatched' then
    raise exception 'not_handled: This line is already in the list.';
  end if;
  return l;
end $$;

create function private.bank_via(p_via text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p_via is null or p_via not in ('auto', 'app', 'agent') then raise exception 'Unknown handler %', p_via; end if;
  return p_via;
end $$;

grant execute on function private.bank_line_lock(uuid, public.bank_line_status) to authenticated;
grant execute on function private.bank_via(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------------------------------------------------

-- Add to the books: one entry with the line's date, direction, amount and currency, linked to it. Returns its id.
create function public.bank_line_book(
  p_line uuid, p_villa uuid, p_category uuid, p_description text, p_fx numeric,
  p_via text default 'app', p_note text default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  l    public.bank_lines := private.bank_line_lock(p_line);
  rep  char(3);
  fx   numeric;
  kind text;
  wanted text;
  tx   uuid;
begin
  select reporting_currency into rep from public.organizations where id = l.organization_id;
  fx := case when l.currency = rep then 1 else p_fx end;
  if fx is null or fx <= 0 then
    raise exception 'fx_rate_required: Give the % → % rate.', l.currency, rep;
  end if;
  wanted := case l.direction when 'in' then 'income' else 'expense' end;
  if p_category is not null then
    select c.kind into kind from public.categories c where c.id = p_category and c.organization_id = l.organization_id;
    if kind is distinct from wanted then
      raise exception 'invalid_category: Use an % category for money %.', wanted, l.direction;
    end if;
  end if;

  insert into public.transactions (organization_id, villa_id, date, direction, category_id, description,
                                   currency, amount, fx_rate, status, source)
  values (l.organization_id, p_villa, l.date, l.direction, p_category, nullif(btrim(p_description), ''),
          l.currency, l.amount, fx, 'validated', 'module')
  returning id into tx;

  update public.bank_lines set status = 'matched', transaction_id = tx, matched_by = 'created',
    handled_via = private.bank_via(p_via), handled_by = auth.uid(), handled_at = now(), handled_note = nullif(btrim(p_note), '')
  where id = l.id;
  return tx;
end $$;

-- Several lines booked as one entry or as shares of one (a month's bank charges). p_entries: rows for
-- public.transactions (villa_id, date, direction, category_id, description, currency, amount, fx_rate);
-- the lines link to the first one, and the shares are tied by a split group so they are deleted together.
create function public.bank_lines_book_group(p_lines uuid[], p_entries jsonb, p_via text default 'app', p_note text default null)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  org   uuid;
  l     public.bank_lines;
  v_id  uuid;
  v_first uuid;
  grp   uuid := case when jsonb_array_length(p_entries) > 1 then gen_random_uuid() end;
  e     jsonb;
  tx    uuid;
  cur   char(3);
  lines_net   numeric;
  entries_net numeric;
begin
  if coalesce(array_length(p_lines, 1), 0) = 0 or coalesce(jsonb_array_length(p_entries), 0) = 0 then
    raise exception 'Nothing to book';
  end if;
  foreach v_id in array (select array_agg(x order by x) from unnest(p_lines) x) loop  -- same order everywhere: no deadlock
    l := private.bank_line_lock(v_id);
    if org is null then org := l.organization_id; elsif org <> l.organization_id then raise exception 'not_found: No bank line with that id.'; end if;
  end loop;

  -- The entries must be the lines' money: same currency, same net total, categories of the right kind.
  select l2.currency into cur from public.bank_lines l2 where l2.id = p_lines[1];
  if exists (select 1 from public.bank_lines l2 where l2.id = any (p_lines) and l2.currency <> cur)
     or exists (select 1 from jsonb_array_elements(p_entries) x where x->>'currency' is distinct from cur) then
    raise exception 'invalid_entries: The lines and the entries must all be in one currency.';
  end if;
  select coalesce(sum(case l2.direction when 'in' then l2.amount else -l2.amount end), 0) into lines_net
  from public.bank_lines l2 where l2.id = any (p_lines);
  select coalesce(sum(case x->>'direction' when 'in' then (x->>'amount')::numeric else -(x->>'amount')::numeric end), 0) into entries_net
  from jsonb_array_elements(p_entries) x;
  if abs(lines_net - entries_net) >= 0.005 then
    raise exception 'invalid_entries: The entries come to %, the lines to %.', entries_net, lines_net;
  end if;
  if exists (select 1 from jsonb_array_elements(p_entries) x join public.categories c on c.id = nullif(x->>'category_id', '')::uuid
             where c.organization_id <> org or c.kind::text <> case x->>'direction' when 'in' then 'income' else 'expense' end) then
    raise exception 'invalid_category: A category does not fit its entry.';
  end if;

  for e in select value from jsonb_array_elements(p_entries) loop
    insert into public.transactions (organization_id, villa_id, date, direction, category_id, description,
                                     currency, amount, fx_rate, status, source, split_group)
    values (org, (e->>'villa_id')::uuid, (e->>'date')::date, (e->>'direction')::public.tx_direction,
            nullif(e->>'category_id', '')::uuid, e->>'description', e->>'currency', (e->>'amount')::numeric,
            coalesce((e->>'fx_rate')::numeric, 1), 'validated', 'module', grp)
    returning transactions.id into tx;
    v_first := coalesce(v_first, tx);
  end loop;

  update public.bank_lines set status = 'matched', transaction_id = v_first, matched_by = 'created',
    handled_via = private.bank_via(p_via), handled_by = auth.uid(), handled_at = now(), handled_note = nullif(btrim(p_note), '')
  where bank_lines.id = any (p_lines);
  return v_first;
end $$;

-- Link to an entry already in the books. The entry is locked too: two lines can never claim it at once.
-- With p_same_amount, the entry must be the line's amount (in the line's currency, or converted to it within 0.01%):
-- checked here, under the lock, so an entry edited meanwhile cannot slip through.
create function public.bank_line_link(
  p_line uuid, p_transaction uuid, p_by text default 'manual', p_via text default 'app', p_note text default null,
  p_same_amount boolean default false
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  l   public.bank_lines := private.bank_line_lock(p_line);
  t   public.transactions;
  rep char(3);
  cmp numeric;
  tol numeric;
begin
  if p_by not in ('auto', 'manual') then raise exception 'Unknown match kind %', p_by; end if;
  select * into t from public.transactions
  where id = p_transaction and organization_id = l.organization_id and status = 'validated' for update;
  if not found then raise exception 'not_found: No booked entry with that id.'; end if;
  if t.direction <> l.direction then
    raise exception 'direction_mismatch: The line is money %, the entry money %.', l.direction, t.direction;
  end if;
  if t.stay_id is not null then
    raise exception 'stay_entry: That entry is the income of a stay: link the stay instead.';
  end if;
  if exists (select 1 from public.bank_lines x where x.transaction_id = t.id) then
    raise exception 'entry_taken: That entry is already linked to another bank line.';
  end if;
  if p_same_amount then
    select reporting_currency into rep from public.organizations where id = l.organization_id;
    cmp := case when t.currency = l.currency then t.amount when l.currency = rep then t.amount_reporting end;
    tol := case when t.currency = l.currency then 0.005 else 0.01 + l.amount * 0.0001 end;
    if cmp is null or abs(cmp - l.amount) >= tol then
      raise exception 'amount_mismatch: The line is % %, the entry % %.', l.amount, l.currency, t.amount, t.currency;
    end if;
  end if;
  update public.bank_lines set status = 'matched', transaction_id = t.id, matched_by = p_by,
    handled_via = private.bank_via(p_via), handled_by = auth.uid(), handled_at = now(), handled_note = nullif(btrim(p_note), '')
  where id = l.id;
end $$;

-- Link money in to the stays it pays (an Airbnb payout for several stays, a deposit, the balance).
create function public.bank_line_link_stays(
  p_line uuid, p_stays uuid[], p_by text default 'manual', p_via text default 'app', p_note text default null
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  l public.bank_lines := private.bank_line_lock(p_line);
  wanted int := (select count(distinct x) from unnest(p_stays) x);
  added  int;
begin
  if p_by not in ('auto', 'manual') then raise exception 'Unknown match kind %', p_by; end if;
  if l.direction <> 'in' then raise exception 'direction_mismatch: Only money in can pay a stay.'; end if;
  if wanted = 0 or wanted > 20 then raise exception 'not_found: Give 1 to 20 stays.'; end if;
  insert into public.bank_line_stays (organization_id, line_id, stay_id)
  select l.organization_id, l.id, s.id from public.stays s
  where s.id = any (p_stays) and s.organization_id = l.organization_id;
  get diagnostics added = row_count;
  if added <> wanted then raise exception 'not_found: No stay with that id.'; end if;
  update public.bank_lines set status = 'matched', matched_by = p_by,
    handled_via = private.bank_via(p_via), handled_by = auth.uid(), handled_at = now(), handled_note = nullif(btrim(p_note), '')
  where id = l.id;
end $$;

create function public.bank_line_personal(p_line uuid, p_reason text default null, p_via text default 'app', p_note text default null)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  l public.bank_lines := private.bank_line_lock(p_line);
begin
  update public.bank_lines set status = 'personal', personal_reason = p_reason,
    handled_via = private.bank_via(p_via), handled_by = auth.uid(), handled_at = now(), handled_note = nullif(btrim(p_note), '')
  where id = l.id;
end $$;

-- Put a handled line back in the list. The entry created from it stays in the books, unless p_delete_entry and it
-- is safe to delete: exactly this line (same amount, currency, date and direction: not a month of bank charges, not
-- edited since), linked to no other line, no receipt, not one share of several, open month. Returns what was undone.
-- Deleting locks the entry before the line, in the same order as a plain delete of the entry (whose foreign key
-- updates the line), so the two can never deadlock.
create function public.bank_line_reset(p_line uuid, p_delete_entry boolean default false)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  l     public.bank_lines;
  t     public.transactions;
  v_tx  uuid;
  deleted boolean := false;
begin
  if p_delete_entry then
    select transaction_id into v_tx from public.bank_lines where id = p_line;
    if v_tx is not null then
      select * into t from public.transactions where id = v_tx for update;
    end if;
  end if;
  l := private.bank_line_lock(p_line, null);

  if p_delete_entry then
    if l.matched_by is distinct from 'created' or l.transaction_id is null then
      raise exception 'cannot_delete: This line was not added to the books from the bank; only the link is undone without deleting.';
    end if;
    if l.transaction_id is distinct from v_tx or t.id is null then
      raise exception 'already_handled: The line changed meanwhile; look at it again.';
    end if;
    if exists (select 1 from public.bank_lines x where x.transaction_id = t.id and x.id <> l.id) then
      raise exception 'cannot_delete: The entry also covers other bank lines (bank charges).';
    end if;
    if t.split_group is not null then
      raise exception 'cannot_delete: The entry is one share of several; delete it from Transactions.';
    end if;
    if t.source <> 'module' or t.amount <> l.amount or t.currency <> l.currency or t.date <> l.date or t.direction <> l.direction then
      raise exception 'cannot_delete: The entry is not this bank line alone (bank charges, or edited since); delete it from Transactions if it is wrong.';
    end if;
    if exists (select 1 from public.evidence e where e.transaction_id = t.id) then
      raise exception 'cannot_delete: The entry has a receipt attached; delete it from Transactions if it is wrong.';
    end if;
  end if;

  delete from public.bank_line_stays where line_id = l.id;
  update public.bank_lines set status = 'unmatched', transaction_id = null, matched_by = null, personal_reason = null,
    handled_via = null, handled_by = null, handled_at = null, handled_note = null
  where id = l.id;
  if p_delete_entry then
    delete from public.transactions where id = t.id;  -- a closed month raises here and undoes everything
    deleted := true;
  end if;
  return jsonb_build_object('was', l.status, 'transaction_id', l.transaction_id, 'matched_by', l.matched_by, 'entry_deleted', deleted);
end $$;

revoke execute on function public.bank_line_book(uuid, uuid, uuid, text, numeric, text, text) from public, anon;
revoke execute on function public.bank_lines_book_group(uuid[], jsonb, text, text) from public, anon;
revoke execute on function public.bank_line_link(uuid, uuid, text, text, text, boolean) from public, anon;
revoke execute on function public.bank_line_link_stays(uuid, uuid[], text, text, text) from public, anon;
revoke execute on function public.bank_line_personal(uuid, text, text, text) from public, anon;
revoke execute on function public.bank_line_reset(uuid, boolean) from public, anon;
grant execute on function public.bank_line_book(uuid, uuid, uuid, text, numeric, text, text) to authenticated;
grant execute on function public.bank_lines_book_group(uuid[], jsonb, text, text) to authenticated;
grant execute on function public.bank_line_link(uuid, uuid, text, text, text, boolean) to authenticated;
grant execute on function public.bank_line_link_stays(uuid, uuid[], text, text, text) to authenticated;
grant execute on function public.bank_line_personal(uuid, text, text, text) to authenticated;
grant execute on function public.bank_line_reset(uuid, boolean) to authenticated;

-- The server (service_role) runs the automatic matching after the daily Gmail check. Supabase has the role; the local
-- test database creates it too.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema private to service_role;
    grant execute on function private.bank_line_lock(uuid, public.bank_line_status) to service_role;
    grant execute on function private.bank_via(text) to service_role;
    grant execute on function public.bank_line_link(uuid, uuid, text, text, text, boolean) to service_role;
    grant execute on function public.bank_line_link_stays(uuid, uuid[], text, text, text) to service_role;
  end if;
end $$;
