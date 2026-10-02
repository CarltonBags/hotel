-- Payments, Card Holds and payment provider set-up (ticket 27).

-- one connected account at the payment provider per Legal Entity (direct charges)
create table payment_accounts (
  legal_entity_id uuid primary key references legal_entities(id),
  provider text not null,
  account_id text not null unique,
  charges_enabled boolean not null default false,
  details_submitted boolean not null default false,
  payouts_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text not null,
  updated_at timestamptz not null default now()
);

-- the property's Terminal location at the provider, and its Front Desk refund limit
alter table properties add column terminal_location_id text;
alter table properties add column refund_limit numeric(12, 2) not null default 200 constraint properties_refund_limit_check check (refund_limit >= 0);

create table terminal_readers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  provider text not null,
  reader_id text not null unique,
  label text not null,
  device_type text not null default '',
  created_at timestamptz not null default now(),
  created_by text not null
);
create index terminal_readers_property_idx on terminal_readers(property_id);

-- money received against a folio by one Tender; a refund is a negative payment linked to the original
create table payments (
  id uuid primary key default gen_random_uuid(),
  folio_id uuid not null references folios(id),
  reservation_id uuid not null references reservations(id),
  property_id uuid not null references properties(id),
  tender text not null constraint payments_tender_check check (tender in ('card_terminal', 'bank_transfer', 'on_account', 'ota_virtual_card', 'ota_collect')),
  amount numeric(12, 2) not null constraint payments_amount_check check (amount <> 0),
  currency char(3) not null,
  status text not null constraint payments_status_check check (status in ('pending', 'succeeded', 'failed', 'refund_pending_balance')),
  refund_of uuid references payments(id),
  constraint payments_refund_check check ((refund_of is null) = (amount > 0)),
  provider text,
  provider_intent_id text,
  provider_refund_id text,
  reader_id text,
  card_brand text,
  card_last4 char(4),
  reference text not null default '',
  error text,
  approved_by text,
  posted_at timestamptz not null default clock_timestamp(),
  posted_by text not null,
  settled_at timestamptz
);
create index payments_folio_idx on payments(folio_id);
create index payments_reservation_idx on payments(reservation_id);
create index payments_intent_idx on payments(provider_intent_id) where provider_intent_id is not null;

-- a pre-authorisation on the guest's card; not a payment
create table card_holds (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id),
  property_id uuid not null references properties(id),
  provider text not null,
  provider_intent_id text not null unique,
  reader_id text,
  channel text not null constraint card_holds_channel_check check (channel in ('terminal', 'online', 'moto')),
  -- the card's token at the provider for renewing the hold; never the card number
  payment_method_id text,
  card_brand text,
  card_last4 char(4),
  amount numeric(12, 2) not null constraint card_holds_amount_check check (amount > 0),
  currency char(3) not null,
  increments integer not null default 0,
  extended boolean not null default false,
  status text not null constraint card_holds_status_check check (status in ('pending', 'active', 'captured', 'released', 'expired', 'failed')),
  authorised_at timestamptz,
  expires_at timestamptz,
  warned_at timestamptz,
  renewed_from uuid references card_holds(id),
  captured_amount numeric(12, 2),
  capture_payment_id uuid references payments(id),
  error text,
  created_at timestamptz not null default clock_timestamp(),
  created_by text not null
);
create index card_holds_reservation_idx on card_holds(reservation_id);
create index card_holds_expiry_idx on card_holds(expires_at) where status = 'active';
