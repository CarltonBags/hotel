-- Check-in, Folios, Charges and Routing Rules (ticket 26, ADR 0009, ADR 0010).

-- the room part of a Rate Plan is a Service too: its Tax Code and revenue account apply to room Charges
alter table rate_plans add column accommodation_service_id uuid references services(id);

alter table reservations add column checked_in_at timestamptz;
alter table reservations add column checked_in_by text;

alter table reservation_changes drop constraint reservation_changes_action_check;
alter table reservation_changes add constraint reservation_changes_action_check
  check (action in ('edit', 'cancel', 'assign_room', 'move_room', 'unassign_room', 'fee_confirmed', 'fee_waived', 'check_in'));

-- a Folio has exactly one Bill-to and becomes one Invoice
create table folios (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id),
  number integer not null,
  bill_to_guest_id uuid references guests(id),
  bill_to_company_id uuid references companies(id),
  constraint folios_bill_to_check check ((bill_to_guest_id is null) <> (bill_to_company_id is null)),
  created_at timestamptz not null default now(),
  created_by text not null,
  unique (reservation_id, number)
);

-- Routing Rules per reservation: which folio Charges of a category land on (else folio 1)
create table reservation_routing (
  reservation_id uuid not null references reservations(id) on delete cascade,
  category text not null constraint reservation_routing_category_check check (category in ('accommodation', 'package', 'extras', 'city_tax')),
  folio_id uuid not null references folios(id),
  primary key (reservation_id, category)
);

-- a Charge: one Service for one Service Date, gross with its Tax Code and the rate in force that day
create table charges (
  id uuid primary key default gen_random_uuid(),
  folio_id uuid not null references folios(id),
  reservation_id uuid not null references reservations(id),
  property_id uuid not null references properties(id),
  service_id uuid references services(id),
  description text not null,
  service_date date not null,
  quantity numeric(10, 2) not null default 1,
  unit_price numeric(12, 2) not null,
  amount numeric(12, 2) not null,
  tax_code_id uuid not null references tax_codes(id),
  tax_rate numeric(5, 2) not null,
  revenue_account text not null default '',
  category text not null constraint charges_category_check check (category in ('accommodation', 'package', 'extras', 'city_tax')),
  -- stay: posted from the reservation's nights; catalogue / free_text: posted by staff; fee: early departure
  origin text not null constraint charges_origin_check check (origin in ('stay', 'catalogue', 'free_text', 'fee')),
  -- stay Charges: 'room' or 'svc:<service id>', to keep them in step with the nights
  component text,
  constraint charges_component_check check ((origin = 'stay') = (component is not null)),
  posted_at timestamptz not null default clock_timestamp(),
  posted_by text not null,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  -- voids the stay sync makes itself (null: by hand), told apart from a void by hand without reading its reason
  auto_void text constraint charges_auto_void_check check (auto_void in ('early_departure', 'stay_changed')),
  constraint charges_void_check check ((voided_at is null) = (void_reason is null) and (voided_at is null) = (voided_by is null) and (auto_void is null or voided_at is not null))
);
create index charges_folio_idx on charges(folio_id);
create index charges_reservation_idx on charges(reservation_id, service_date);
-- revenue by Service Date (ADR 0009)
create index charges_property_date_idx on charges(property_id, service_date) where voided_at is null;

-- what happened to a Charge: posted, voided (with reason), moved between folios
create table charge_events (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references charges(id),
  user_id text not null,
  at timestamptz not null default clock_timestamp(),
  action text not null constraint charge_events_action_check check (action in ('post', 'void', 'move')),
  detail jsonb not null default '{}'::jsonb
);
create index charge_events_charge_idx on charge_events(charge_id, at);
