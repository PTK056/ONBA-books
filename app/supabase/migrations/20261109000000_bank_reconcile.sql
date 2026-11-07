-- Splyce — reconciliation, second version.
--
-- 1. The owner's own note on any bank line (in the list or handled), kept when the line is put back in the list.
--    handled_note stays what the assistant or Sply wrote when handling the line.
-- 2. Lines that cancel each other out: a transfer the bank sent back, a deposit refunded. Together they come to zero,
--    so nothing goes in the books; they are set aside as personal with the reason 'returned'.
-- 3. Several lines that together are exactly one entry: a Wise transfer and its fee (Wise splits them, the receipt
--    has the total), two transfers for one invoice. Linked at once, or not at all.

alter table public.bank_lines add column note text check (char_length(note) <= 500);

alter table public.bank_lines drop constraint bank_lines_personal_reason_check;
alter table public.bank_lines add constraint bank_lines_personal_reason_check
  check (personal_reason in ('owner_transfer', 'owner_contribution', 'private_expense', 'internal_transfer', 'returned'));
alter table public.bank_proposals drop constraint bank_proposals_personal_reason_check;
alter table public.bank_proposals add constraint bank_proposals_personal_reason_check
  check (personal_reason in ('owner_transfer', 'owner_contribution', 'private_expense', 'internal_transfer', 'returned'));

-- The lines, locked in one order (no deadlock), all still to do and of one organization. 2 to 10 distinct lines.
create function private.bank_lines_lock(p_lines uuid[]) returns public.bank_lines[]
language plpgsql security invoker set search_path = '' as $$
declare
  ids uuid[] := (select array_agg(distinct x order by x) from unnest(p_lines) x);
  res public.bank_lines[] := '{}';
  l   public.bank_lines;
  v   uuid;
begin
  if coalesce(array_length(ids, 1), 0) < 2 or array_length(ids, 1) > 10 then
    raise exception 'not_found: Give 2 to 10 different bank lines.';
  end if;
  foreach v in array ids loop
    l := private.bank_line_lock(v);
    if array_length(res, 1) > 0 and res[1].organization_id <> l.organization_id then
      raise exception 'not_found: No bank line with that id.';
    end if;
    res := res || l;
  end loop;
  return res;
end $$;

-- 'returned' only comes with the lines it cancels out with (bank_lines_cancel), never on one line alone.
create or replace function public.bank_line_personal(p_line uuid, p_reason text default null, p_via text default 'app', p_note text default null)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  l public.bank_lines := private.bank_line_lock(p_line);
begin
  if p_reason = 'returned' then
    raise exception 'invalid_entries: Money sent back is set aside with the lines it cancels out with, not alone.';
  end if;
  update public.bank_lines set status = 'personal', personal_reason = p_reason,
    handled_via = private.bank_via(p_via), handled_by = auth.uid(), handled_at = now(), handled_note = nullif(btrim(p_note), '')
  where id = l.id;
end $$;

-- Lines that cancel each other out (money out and the same money back, in one currency): set aside together.
create function public.bank_lines_cancel(p_lines uuid[], p_via text default 'app', p_note text default null)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  ls  public.bank_lines[] := private.bank_lines_lock(p_lines);
  net numeric;
begin
  if (select count(distinct x.currency) from unnest(ls) x) > 1 then
    raise exception 'invalid_entries: The lines are in several currencies.';
  end if;
  -- Money sent back comes back to the account it left; between two accounts it is a transfer (internal_transfer).
  if (select count(distinct x.account_id) from unnest(ls) x) > 1 then
    raise exception 'invalid_entries: The lines are in several accounts: mark a move between accounts as personal, between own accounts.';
  end if;
  if not exists (select 1 from unnest(ls) x where x.direction = 'in') or not exists (select 1 from unnest(ls) x where x.direction = 'out') then
    raise exception 'direction_mismatch: Give money out and the money that came back.';
  end if;
  select sum(case x.direction when 'in' then x.amount else -x.amount end) into net from unnest(ls) x;
  if abs(net) >= 0.005 then
    raise exception 'amount_mismatch: The lines do not cancel out (% left).', net;
  end if;
  update public.bank_lines set status = 'personal', personal_reason = 'returned',
    handled_via = private.bank_via(p_via), handled_by = auth.uid(), handled_at = now(), handled_note = nullif(btrim(p_note), '')
  where id = any (select x.id from unnest(ls) x);
end $$;

-- Several lines that together are one entry no line pays yet: same direction, one currency, and together exactly the
-- entry (in the lines' currency, or converted to it within 0.01%, as the same-amount check of bank_line_link).
create function public.bank_lines_link_entry(
  p_lines uuid[], p_transaction uuid, p_by text default 'manual', p_via text default 'app', p_note text default null
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  ls  public.bank_lines[];
  t   public.transactions;
  rep char(3);
  cur char(3);
  total numeric;
  cmp numeric;
  tol numeric;
begin
  if p_by not in ('auto', 'manual') then raise exception 'Unknown match kind %', p_by; end if;
  -- The lines first, then the entry: the same order as bank_line_link.
  ls := private.bank_lines_lock(p_lines);
  select * into t from public.transactions where id = p_transaction and status = 'validated' for update;
  if t.id is null or t.organization_id <> ls[1].organization_id then raise exception 'not_found: No booked entry with that id.'; end if;
  if exists (select 1 from unnest(ls) x where x.direction <> t.direction) then
    raise exception 'direction_mismatch: The lines and the entry are not all money %.', t.direction;
  end if;
  if t.stay_id is not null then
    raise exception 'stay_entry: That entry is the income of a stay: link the stay instead.';
  end if;
  if exists (select 1 from public.bank_lines x where x.transaction_id = t.id) then
    raise exception 'entry_taken: That entry is already linked to another bank line.';
  end if;
  if (select count(distinct x.currency) from unnest(ls) x) > 1 then
    raise exception 'amount_mismatch: The lines are in several currencies.';
  end if;
  cur := ls[1].currency;
  select reporting_currency into rep from public.organizations where id = t.organization_id;
  select sum(x.amount) into total from unnest(ls) x;
  cmp := case when t.currency = cur then t.amount when cur = rep then t.amount_reporting end;
  tol := case when t.currency = cur then 0.005 else 0.01 + total * 0.0001 end;
  if cmp is null or abs(cmp - total) >= tol then
    raise exception 'amount_mismatch: The lines come to % %, the entry is % %.', total, cur, t.amount, t.currency;
  end if;
  update public.bank_lines set status = 'matched', transaction_id = t.id, matched_by = p_by,
    handled_via = private.bank_via(p_via), handled_by = auth.uid(), handled_at = now(), handled_note = nullif(btrim(p_note), '')
  where id = any (select x.id from unnest(ls) x);
end $$;

revoke execute on function public.bank_lines_cancel(uuid[], text, text) from public, anon;
revoke execute on function public.bank_lines_link_entry(uuid[], uuid, text, text, text) from public, anon;
grant execute on function private.bank_lines_lock(uuid[]) to authenticated;
grant execute on function public.bank_lines_cancel(uuid[], text, text) to authenticated;
grant execute on function public.bank_lines_link_entry(uuid[], uuid, text, text, text) to authenticated;
-- The server runs the automatic matching after the daily Gmail check (a transfer and its fee are linked there too).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function private.bank_lines_lock(uuid[]) to service_role;
    grant execute on function public.bank_lines_link_entry(uuid[], uuid, text, text, text) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Sply Accountant: lines that cancel out are proposed as one set. Each line of the set gets a proposal carrying the
-- whole set (line_ids); accepting any of them sets the whole set aside through bank_lines_cancel (all or nothing), and
-- the others go stale by themselves (trigger bank_proposal_stale). Declining one declines the set.
-- ---------------------------------------------------------------------------------------------------------------

alter table public.bank_proposals add column line_ids uuid[];
alter table public.bank_proposals add constraint bank_proposals_returned_set
  check (personal_reason is distinct from 'returned' or coalesce(cardinality(line_ids), 0) between 2 and 10);

create or replace function public.bank_proposal_add(p_run uuid, p jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  org  uuid;
  st   public.bank_line_status;
  id   uuid;
  ids  uuid[] := case when jsonb_typeof(p->'line_ids') = 'array' then array(select jsonb_array_elements_text(p->'line_ids')::uuid) end;
begin
  select r.organization_id into org from public.bank_accountant_runs r where r.id = p_run and r.finished_at is null;
  if org is null or not private.is_admin(org) then raise exception 'not_found: No such pass.'; end if;
  select l.status into st from public.bank_lines l where l.id = (p->>'line_id')::uuid and l.organization_id = org for share;
  if st is distinct from 'unmatched' then return null; end if;
  -- A set: its own line among them, and every line of this organization.
  if ids is not null and (not (p->>'line_id')::uuid = any (ids)
      or (select count(*) from public.bank_lines l where l.id = any (ids) and l.organization_id = org) <> cardinality(ids)) then
    raise exception 'not_found: No bank line with that id.';
  end if;
  insert into public.bank_proposals (organization_id, run_id, line_id, action, villa_id, category_id, description,
    transaction_id, stay_ids, personal_reason, statement_id, amount_differs, fx_rate, confidence, why, question, line_ids)
  values (org, p_run, (p->>'line_id')::uuid, p->>'action', nullif(p->>'villa_id', '')::uuid, nullif(p->>'category_id', '')::uuid,
    p->>'description', nullif(p->>'transaction_id', '')::uuid,
    case when jsonb_typeof(p->'stay_ids') = 'array' then array(select jsonb_array_elements_text(p->'stay_ids')::uuid) end,
    p->>'personal_reason', nullif(p->>'statement_id', '')::uuid, coalesce((p->>'amount_differs')::boolean, false),
    nullif(p->>'fx_rate', '')::numeric, p->>'confidence', p->>'why', p->>'question', ids)
  on conflict (line_id) where status = 'pending' do nothing
  returning bank_proposals.id into id;
  return id;
end $$;

-- Declining one proposal of a set declines the others still open (only by whoever declined it).
create function public.bank_proposal_set_rejected(p_proposal uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.bank_proposals;
begin
  select * into p from public.bank_proposals where id = p_proposal and status = 'rejected' and decided_by = auth.uid()
    and line_ids is not null;
  if p.id is null or not private.is_admin(p.organization_id) then return; end if;
  update public.bank_proposals set status = 'rejected', decided_by = auth.uid(), decided_at = now()
  where run_id = p.run_id and line_id = any (p.line_ids) and id <> p.id and status = 'pending';
end $$;

revoke execute on function public.bank_proposal_set_rejected(uuid) from public, anon;
grant execute on function public.bank_proposal_set_rejected(uuid) to authenticated;
