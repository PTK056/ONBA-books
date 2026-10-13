-- ONBA Books — stays import (Airbnb first)
--
-- The app parses the platform's export, groups lines by booking and splits each booking's
-- gross income and platform fees across months by nights. It then sends the result here,
-- one villa at a time. Each stay is applied in its own subtransaction: a stay touching a
-- closed month is reported as a conflict and the others still go through. Re-importing
-- the same file changes nothing.

-- Platform fees get their own expense category.
insert into public.categories (organization_id, kind, name)
select o.id, 'expense', 'Platform fees' from public.organizations o
on conflict (organization_id, kind, name) do nothing;

create or replace function public.create_organization(org_name text, reporting_currency char(3) default 'USD')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  org uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  insert into public.organizations (name, reporting_currency)
  values (org_name, reporting_currency)
  returning id into org;

  insert into public.memberships (organization_id, user_id, role)
  values (org, auth.uid(), 'admin');

  insert into public.categories (organization_id, kind, name)
  select org, k::public.category_kind, n
  from (values
    ('income',  'Accommodation'),
    ('income',  'Extra services'),
    ('income',  'Other income'),
    ('expense', 'Staff'),
    ('expense', 'Utilities'),
    ('expense', 'Internet & TV'),
    ('expense', 'Cleaning & laundry'),
    ('expense', 'Guest supplies'),
    ('expense', 'Maintenance & repairs'),
    ('expense', 'Pool & garden'),
    ('expense', 'Furniture & equipment'),
    ('expense', 'Management fees'),
    ('expense', 'Platform fees'),
    ('expense', 'Taxes & licences'),
    ('expense', 'Insurance'),
    ('expense', 'Bank fees'),
    ('expense', 'Other expenses')
  ) as d(k, n);

  return org;
end;
$$;

-- Imported stays are backed by the platform's export, not by a receipt.
create or replace view public.expenses_missing_evidence
with (security_invoker = true) as
select t.*
from public.transactions t
join public.organizations o on o.id = t.organization_id
where t.direction = 'out'
  and t.status = 'validated'
  and t.source <> 'stay'
  and t.amount_reporting >= o.evidence_threshold
  and not exists (select 1 from public.evidence e where e.transaction_id = t.id);

-- p_stays: [{ code, guest, check_in, check_out, currency, gross, fees, payout_date,
--             lines: [{ date, direction, category, amount, currency, fx_rate, description }] }]
-- Returns { created, updated, unchanged, conflicts: [{ code, reason }] }.
create function public.import_stays(p_villa uuid, p_platform public.stay_platform, p_stays jsonb)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_org      uuid;
  s          jsonb;
  v_stay     public.stays;
  v_id       uuid;
  wanted     jsonb;
  existing   jsonb;
  created    int := 0;
  updated    int := 0;
  unchanged  int := 0;
  conflicts  jsonb := '[]'::jsonb;
begin
  select organization_id into v_org from public.villas where id = p_villa;
  if v_org is null then
    raise exception 'Villa not found' using errcode = 'no_data_found';
  end if;

  for s in select value from jsonb_array_elements(p_stays) loop
    begin
      -- Lines as they would be stored, with category ids resolved in this organization.
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', l->>'date', 'direction', l->>'direction', 'category_id', c.id::text,
               'amount', (l->>'amount')::numeric, 'currency', l->>'currency',
               'fx_rate', (l->>'fx_rate')::numeric, 'description', l->>'description')
             order by l->>'date', l->>'direction', c.id::text), '[]'::jsonb)
        into wanted
        from jsonb_array_elements(s->'lines') l
        left join public.categories c
          on c.organization_id = v_org
         and c.name = l->>'category'
         and c.kind = case when l->>'direction' = 'in' then 'income' else 'expense' end::public.category_kind;

      select * into v_stay from public.stays
       where villa_id = p_villa and platform = p_platform and external_ref = s->>'code';

      if found then
        select coalesce(jsonb_agg(jsonb_build_object(
                 'date', t.date::text, 'direction', t.direction::text, 'category_id', t.category_id::text,
                 'amount', t.amount, 'currency', t.currency::text, 'fx_rate', t.fx_rate, 'description', t.description)
               order by t.date::text, t.direction::text, t.category_id::text), '[]'::jsonb)
          into existing
          from public.transactions t where t.stay_id = v_stay.id;

        if existing = wanted
           and v_stay.check_in = (s->>'check_in')::date and v_stay.check_out = (s->>'check_out')::date
           and v_stay.gross_amount = (s->>'gross')::numeric and v_stay.platform_fees = (s->>'fees')::numeric
           and v_stay.currency = s->>'currency'
           and v_stay.payout_date is not distinct from (s->>'payout_date')::date
           and v_stay.guest_name is not distinct from s->>'guest' then
          unchanged := unchanged + 1;
          continue;
        end if;

        delete from public.transactions where stay_id = v_stay.id;
        update public.stays
           set check_in = (s->>'check_in')::date, check_out = (s->>'check_out')::date,
               gross_amount = (s->>'gross')::numeric, platform_fees = (s->>'fees')::numeric,
               currency = s->>'currency', payout_date = (s->>'payout_date')::date, guest_name = s->>'guest'
         where id = v_stay.id;
        v_id := v_stay.id;
        updated := updated + 1;
      else
        insert into public.stays (organization_id, villa_id, platform, external_ref, guest_name,
                                  check_in, check_out, currency, gross_amount, platform_fees, payout_date)
        values (v_org, p_villa, p_platform, s->>'code', s->>'guest',
                (s->>'check_in')::date, (s->>'check_out')::date, s->>'currency',
                (s->>'gross')::numeric, (s->>'fees')::numeric, (s->>'payout_date')::date)
        returning id into v_id;
        created := created + 1;
      end if;

      insert into public.transactions (organization_id, villa_id, date, direction, category_id, description,
                                       currency, amount, fx_rate, status, source, stay_id)
      select v_org, p_villa, (w->>'date')::date, (w->>'direction')::public.tx_direction,
             (w->>'category_id')::uuid, w->>'description', w->>'currency',
             (w->>'amount')::numeric, (w->>'fx_rate')::numeric, 'validated', 'stay', v_id
        from jsonb_array_elements(wanted) w;

    exception when check_violation then
      -- Typically a closed month; this stay is left as it was.
      conflicts := conflicts || jsonb_build_object('code', s->>'code', 'reason', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('created', created, 'updated', updated, 'unchanged', unchanged, 'conflicts', conflicts);
end;
$$;

revoke execute on function public.import_stays(uuid, public.stay_platform, jsonb) from public, anon;
grant execute on function public.import_stays(uuid, public.stay_platform, jsonb) to authenticated;
