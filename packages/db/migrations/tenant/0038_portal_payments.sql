-- Portal payments, stored cards and express checkout (ticket 41).

-- a Card Guarantee the guest leaves in the portal: the provider's customer and card token only, never the number
create table card_guarantees (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  provider text not null,
  customer_id text not null,
  payment_method_id text not null,
  brand text,
  last4 char(4),
  status text not null default 'secured' constraint card_guarantees_status_check check (status in ('secured', 'removed')),
  secured_at timestamptz not null default now(),
  created_by text not null
);
-- one card secures a stay at a time
create unique index card_guarantees_secured_key on card_guarantees(reservation_id) where status = 'secured';

-- a card being stored in the guest's browser (strong customer authentication), until it is
create table card_setups (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  provider text not null,
  -- set once the provider prepared it (the row comes first, its id is the request's idempotency key)
  provider_setup_id text unique,
  customer_id text,
  status text not null default 'waiting' constraint card_setups_status_check check (status in ('waiting', 'succeeded', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

-- a payment the guest makes in the portal may keep the card as the stay's Card Guarantee
alter table payments add column save_card boolean not null default false;
-- a declined portal payment: when the desk was told (once, whoever saw the decline first)
alter table payments add column decline_noticed_at timestamptz;

-- express checkout: the property lets the guest check out alone (else the desk does, the guest asked for it)
alter table properties add column express_checkout_auto boolean not null default false;
alter table reservations add column express_checkout_at timestamptz;
