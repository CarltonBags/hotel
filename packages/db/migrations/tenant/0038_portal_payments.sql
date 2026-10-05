-- Portal payments, stored cards and express checkout (ticket 41).

-- a card stored for incidentals: the provider's customer and card token only, never the number; a Card Guarantee
create table card_guarantees (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  provider text not null,
  customer_id text not null,
  payment_method_id text not null,
  brand text,
  last4 char(4),
  source text not null constraint card_guarantees_source_check check (source in ('portal', 'desk', 'channel')),
  status text not null default 'secured' constraint card_guarantees_status_check check (status in ('secured', 'removed')),
  secured_at timestamptz not null default now(),
  created_by text not null
);
create index card_guarantees_reservation_idx on card_guarantees(reservation_id) where status = 'secured';

-- a card being stored in the guest's browser (strong customer authentication), until it is
create table card_setups (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  provider text not null,
  provider_setup_id text not null unique,
  customer_id text not null,
  status text not null default 'waiting' constraint card_setups_status_check check (status in ('waiting', 'succeeded', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

-- a payment the guest makes in the portal may keep the card: the provider's customer it is kept on
alter table payments add column save_card boolean not null default false;

-- express checkout: the property lets the guest check out alone (else the desk does, the guest asked for it)
alter table properties add column express_checkout_auto boolean not null default false;
alter table reservations add column express_checkout_at timestamptz;
