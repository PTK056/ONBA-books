-- The company itself, next to the villas: where an organization books what belongs to no villa
-- (bank fees, interest, accountant, virtual office, licences), and later its management fees.
--
-- Stored as a villa of kind 'company' so every entry still has a villa: month closes, the audit log,
-- RLS and statements keep working unchanged. It is never a place to stay: no stays, no owners
-- (so owners never see it), no occupancy. One per organization, created with it.

create type public.villa_kind as enum ('villa', 'company');

alter table public.villas add column kind public.villa_kind not null default 'villa';
create unique index villas_one_company on public.villas (organization_id) where kind = 'company';

insert into public.villas (organization_id, name, currency, kind)
select o.id, 'Company', o.reporting_currency, 'company' from public.organizations o
where not exists (select 1 from public.villas v where v.organization_id = o.id and v.kind = 'company');

create function private.require_real_villa() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.villas v where v.id = new.villa_id and v.kind = 'company') then
    raise exception 'The company is not a villa: % cannot point to it', tg_table_name using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger stays_real_villa before insert or update of villa_id on public.stays
  for each row execute function private.require_real_villa();
create trigger villa_ownerships_real_villa before insert or update of villa_id on public.villa_ownerships
  for each row execute function private.require_real_villa();

-- The company can be renamed, never archived or turned into a villa (and no villa into a second company).
create function private.company_stays() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.kind is distinct from new.kind then
    raise exception 'A villa cannot become the company, nor the company a villa' using errcode = 'check_violation';
  end if;
  if new.kind = 'company' and new.archived_at is not null then
    raise exception 'The company cannot be archived' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger villas_company_stays before update on public.villas
  for each row execute function private.company_stays();

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
  if (select count(*) from public.memberships m where m.user_id = auth.uid() and m.role = 'admin') >= 3 then
    raise exception 'Too many organizations for one account' using errcode = 'insufficient_privilege';
  end if;

  insert into public.organizations (name, reporting_currency)
  values (org_name, reporting_currency)
  returning id into org;

  insert into public.memberships (organization_id, user_id, role)
  values (org, auth.uid(), 'admin');

  insert into public.villas (organization_id, name, currency, kind)
  values (org, 'Company', reporting_currency, 'company');

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
