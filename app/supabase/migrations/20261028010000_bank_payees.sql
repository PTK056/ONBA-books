-- Regular payees: Splyce remembers where the last payment to (or from) someone was booked, and offers the same
-- villa, category and description next time. A payee is known by the last 4 digits of their account when the
-- statement gives them (Wise does), else by the distinctive words of their name. Never a full account number.
-- Admins only, like the rest of the bank module.

alter table public.bank_lines add column payee_last4 text check (payee_last4 ~ '^[0-9]{2,4}$');

create table public.bank_payees (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  key              text not null check (key ~ '^(acct|name):'),   -- acct:5466 or name:jiwa
  name             text,
  direction        public.tx_direction not null,
  villa_id         uuid,
  category_id      uuid,
  description      text,
  uses             integer not null default 1,
  last_used        date not null default current_date,
  primary key (organization_id, key, direction),
  foreign key (villa_id, organization_id)    references public.villas(id, organization_id) on delete set null (villa_id),
  foreign key (category_id, organization_id) references public.categories(id, organization_id) on delete set null (category_id)
);

alter table public.bank_payees enable row level security;
create policy bank_payees_admin on public.bank_payees for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));
