-- Splyce — part payments: one entry paid in several transfers (furniture bought for a total, paid to several
-- suppliers; a deposit, then the balance). A bank line may join an entry other lines already pay, when asked to
-- (p_part), as long as the lines together never pay more than the entry. Automatic matching and Sply Accountant
-- never ask: only a person does, in the Bank tab or through the assistant.

-- Payments are added up in the entry's own currency, or in the reporting currency it was converted to: to the cent
-- when they are all in one of the two; when some are in each, as shares of the entry, 0.01% over allowed (rounding).
create function private.bank_part_slack() returns numeric language sql immutable set search_path = '' as $$ select 0.0001 $$;

-- Link to an entry already in the books (as in migration bank_agent), or with p_part as one of several payments of an
-- entry (the first, or one more): never more than it. The entry is locked: two lines can never claim it at once, nor
-- together pay more than it.
drop function public.bank_line_link(uuid, uuid, text, text, text, boolean);
create function public.bank_line_link(
  p_line uuid, p_transaction uuid, p_by text default 'manual', p_via text default 'app', p_note text default null,
  p_same_amount boolean default false, p_part boolean default false
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  l       public.bank_lines := private.bank_line_lock(p_line);
  t       public.transactions;
  rep     char(3);
  cmp     numeric;
  tol     numeric;
  n       integer;
  n_own   integer;
  n_rep   integer;
  s_own   numeric;
  s_rep   numeric;
  over    boolean;
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
  select reporting_currency into rep from public.organizations where id = l.organization_id;

  select count(*),
         count(*) filter (where x.currency = t.currency), coalesce(sum(x.amount) filter (where x.currency = t.currency), 0),
         count(*) filter (where x.currency <> t.currency and x.currency = rep),
         coalesce(sum(x.amount) filter (where x.currency <> t.currency and x.currency = rep), 0)
    into n, n_own, s_own, n_rep, s_rep
  from public.bank_lines x where x.transaction_id = t.id;
  if n > 0 then
    if not p_part then
      raise exception 'entry_taken: That entry is already linked to another bank line.';
    end if;
    if n > n_own + n_rep or (l.currency <> t.currency and l.currency <> rep) then
      raise exception 'amount_mismatch: The entry''s payments are in currencies that cannot be added up with this line.';
    end if;
    if l.currency = t.currency then n_own := n_own + 1; s_own := s_own + l.amount;
    else n_rep := n_rep + 1; s_rep := s_rep + l.amount; end if;
    over := case
      when n_rep = 0 then s_own > t.amount + 0.005
      when n_own = 0 then s_rep > t.amount_reporting + 0.005
      else s_own / t.amount + s_rep / nullif(t.amount_reporting, 0) > 1 + private.bank_part_slack() end;
    if over is not false then
      raise exception 'entry_taken: The bank lines already linked to that entry (%) would pay more than it with this one.', n;
    end if;
  elsif p_part then
    -- The first payment of several: never more than the entry, to the cent (converted: within 0.01%).
    if l.currency = t.currency then over := l.amount > t.amount + 0.005;
    elsif l.currency = rep then over := l.amount > t.amount_reporting + 0.005;
    else raise exception 'amount_mismatch: The line is % %, the entry % %: they cannot be compared.', l.amount, l.currency, t.amount, t.currency;
    end if;
    if over then
      raise exception 'amount_mismatch: The line (% %) is more than the whole entry (% %).', l.amount, l.currency, t.amount, t.currency;
    end if;
  elsif p_same_amount then
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

revoke execute on function public.bank_line_link(uuid, uuid, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.bank_line_link(uuid, uuid, text, text, text, boolean, boolean) to authenticated;
grant execute on function private.bank_part_slack() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.bank_line_link(uuid, uuid, text, text, text, boolean, boolean) to service_role;
    grant execute on function private.bank_part_slack() to service_role;
  end if;
end $$;

-- Advisor (function_search_path_mutable): a fixed search_path, though it only returns a constant.
alter function private.bank_proposal_lease() set search_path = '';
