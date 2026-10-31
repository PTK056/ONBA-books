-- Splyce — stays from the platform's e-mails (docs/module-gmail-reservations.md).
--
-- Flow:
--   1. An admin connects the organization's Gmail (through Composio for the pilot): mail_connections.
--   2. Once a day the app fetches the e-mails from Airbnb, reads each one (no AI) and logs it in
--      inbound_emails, booked or not and why.
--   3. A confirmed booking becomes a stay (source 'email'); a payout adds a row to stay_payouts
--      and gives the stay its real rate; a cancellation marks it canceled.
--   4. The platform's export (CSV) stays the reference: a stay it wrote is never rewritten by an
--      e-mail, only its status changes.
--
-- Admins only: the connection, the e-mails and the payouts. Staff and owners see the stays.

create type public.stay_status as enum ('confirmed', 'canceled');
create type public.stay_source as enum ('import', 'email', 'manual');

alter table public.stays
  add column status public.stay_status not null default 'confirmed',
  add column source public.stay_source not null default 'import';

-- ---------------------------------------------------------------------------
-- Gmail connection, one per organization.
-- ---------------------------------------------------------------------------

create table public.mail_connections (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null unique references public.organizations(id) on delete cascade,
  provider         text not null default 'gmail' check (provider in ('gmail')),
  broker           text not null default 'composio' check (broker in ('composio')),
  external_id      text not null,               -- Composio connected account id; Google tokens stay at Composio
  status           text not null default 'pending' check (status in ('pending', 'active', 'error')),
  account_label    text,                        -- the Gmail address, for display
  last_checked_at  timestamptz,
  last_error       text,
  created_by       uuid references auth.users(id) default auth.uid(),
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Every e-mail read, booked or not. The e-mail itself is not kept, only what was read from it.
-- ---------------------------------------------------------------------------

create table public.inbound_emails (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  external_id      text not null,               -- Gmail message id
  received_at      timestamptz,
  subject          text not null default '',
  template         text,                        -- the platform's template name, e.g. booking/host/ReservationHostConfirmationTemplate
  kind             text not null check (kind in ('confirmed', 'payout', 'canceled', 'altered', 'support_message', 'ignored', 'unrecognised')),
  code             text,                        -- booking code, when the e-mail is about one booking
  listing_ref      text,                        -- platform's listing id
  parsed           jsonb not null default '{}', -- what was read (amounts, dates, reason)
  result           text not null check (result in ('booked', 'updated', 'unchanged', 'ignored', 'unrecognised',
                                                  'needs_villa', 'conflict', 'alert', 'waiting')),
  note             text,
  stay_id          uuid,
  created_at       timestamptz not null default now(),
  foreign key (stay_id, organization_id) references public.stays(id, organization_id) on delete set null (stay_id),
  unique (organization_id, external_id)
);

create index on public.inbound_emails (organization_id, received_at desc);
create index on public.inbound_emails (organization_id, code);

-- ---------------------------------------------------------------------------
-- Payouts read from e-mails: one row per booking line of a payout.
-- ---------------------------------------------------------------------------

create table public.stay_payouts (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  platform           public.stay_platform not null,
  code               text not null,
  payout_ref         text not null,             -- Airbnb Payout ID
  sent_on            date not null,
  arrives_by         date,
  check_in           date not null,
  check_out          date not null,
  amount             numeric(18,2) not null,    -- in the booking's currency, net of the platform's fees
  currency           char(3) not null check (currency ~ '^[A-Z]{3}$'),
  received           numeric(18,2) not null,    -- this line's share of what reached the bank
  received_currency  char(3) not null check (received_currency ~ '^[A-Z]{3}$'),
  email_id           uuid references public.inbound_emails(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (organization_id, platform, payout_ref, code)
);

create index on public.stay_payouts (organization_id, code);

-- ---------------------------------------------------------------------------
-- Which villa a platform listing is. Asked once, then reused.
-- ---------------------------------------------------------------------------

create table public.listing_villas (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  platform         public.stay_platform not null,
  listing_ref      text not null,
  listing_name     text,
  villa_id         uuid not null,
  created_at       timestamptz not null default now(),
  primary key (organization_id, platform, listing_ref),
  foreign key (villa_id, organization_id) references public.villas(id, organization_id) on delete cascade
);

alter table public.mail_connections enable row level security;
alter table public.inbound_emails   enable row level security;
alter table public.stay_payouts     enable row level security;
alter table public.listing_villas   enable row level security;

create policy mail_connections_admin on public.mail_connections for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));
create policy inbound_emails_admin on public.inbound_emails for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));
create policy stay_payouts_admin on public.stay_payouts for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));
create policy listing_villas_admin on public.listing_villas for all to authenticated
  using (private.is_admin(organization_id)) with check (private.is_admin(organization_id));

-- ---------------------------------------------------------------------------
-- import_stays: each stay may now say where it comes from and its status.
--   source  'import' (platform export, the default), 'email', 'manual'
--   status  'confirmed' (default for a new stay) or 'canceled'; omitted → unchanged
-- A stay written by an export or by hand is never rewritten by an e-mail: only its status moves.
-- ---------------------------------------------------------------------------

create or replace function public.import_stays(p_villa uuid, p_platform public.stay_platform, p_stays jsonb)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_org      uuid;
  s          jsonb;
  v_stay     public.stays;
  v_id       uuid;
  v_source   public.stay_source;
  v_status   public.stay_status;
  v_found    boolean;
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
      v_source := coalesce(s->>'source', 'import')::public.stay_source;

      select * into v_stay from public.stays
       where villa_id = p_villa and platform = p_platform and external_ref = s->>'code';
      v_found := found;
      v_status := coalesce((s->>'status')::public.stay_status, v_stay.status, 'confirmed');

      if v_found and v_source = 'email' and v_stay.source <> 'email' then
        if v_stay.status = v_status then
          unchanged := unchanged + 1;
        else
          update public.stays set status = v_status where id = v_stay.id;
          updated := updated + 1;
        end if;
        continue;
      end if;

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

      if v_found then
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
           and v_stay.guest_name is not distinct from s->>'guest'
           and v_stay.status = v_status and v_stay.source = v_source then
          unchanged := unchanged + 1;
          continue;
        end if;

        delete from public.transactions where stay_id = v_stay.id;
        update public.stays
           set check_in = (s->>'check_in')::date, check_out = (s->>'check_out')::date,
               gross_amount = (s->>'gross')::numeric, platform_fees = (s->>'fees')::numeric,
               currency = s->>'currency', payout_date = (s->>'payout_date')::date, guest_name = s->>'guest',
               status = v_status, source = v_source
         where id = v_stay.id;
        v_id := v_stay.id;
        updated := updated + 1;
      else
        insert into public.stays (organization_id, villa_id, platform, external_ref, guest_name,
                                  check_in, check_out, currency, gross_amount, platform_fees, payout_date,
                                  status, source)
        values (v_org, p_villa, p_platform, s->>'code', s->>'guest',
                (s->>'check_in')::date, (s->>'check_out')::date, s->>'currency',
                (s->>'gross')::numeric, (s->>'fees')::numeric, (s->>'payout_date')::date,
                v_status, v_source)
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
