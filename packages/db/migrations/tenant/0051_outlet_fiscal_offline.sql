-- Outlet fiscal signing and selling without a connection (ticket 62).

-- Germany: every order round is signed as an order (Bestellung) within 45 seconds; a voided item as a new negative one.
-- Order and bill share the bill's table key; the Receipt prints the time of the first order.
create table fiscal_orders (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  client_id uuid not null references fiscal_clients(id),
  bill_id uuid not null references outlet_bills(id),
  round_id uuid references outlet_rounds(id),
  voided_line_id uuid references outlet_bill_lines(id),
  constraint fiscal_orders_source_check check ((round_id is null) <> (voided_line_id is null)),
  -- [{ "quantity": 2, "text": "Pils", "pricePerUnit": 4.5 }], negative quantities for a void
  lines jsonb not null,
  state text not null default 'open' constraint fiscal_orders_state_check check (state in ('open', 'signing', 'signed', 'failed')),
  claim uuid,
  claimed_at timestamptz,
  attempts integer not null default 0,
  error text,
  -- when the order happened (on the device, also offline): signed within 45 seconds of it while the TSE answers
  ordered_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  number bigint,
  time_start timestamptz,
  time_end timestamptz,
  signature text,
  signature_counter bigint,
  signed_at timestamptz
);
create unique index fiscal_orders_round_idx on fiscal_orders(round_id) where round_id is not null;
create unique index fiscal_orders_void_idx on fiscal_orders(voided_line_id) where voided_line_id is not null;
create index fiscal_orders_open_idx on fiscal_orders(created_at) where state in ('open', 'signing', 'failed');
create index fiscal_orders_bill_idx on fiscal_orders(bill_id);

-- a round may come from a device that sold without a connection: when it was really ordered
alter table outlet_rounds add column ordered_at timestamptz;

-- a Receipt issued while the device had no connection: printed with that note, signed when it syncs
alter table receipts add column issued_offline_at timestamptz;

-- what the device sent after selling offline, applied once each, in order
create table outlet_sync_ops (
  op_id uuid primary key,
  outlet_id uuid not null references outlets(id),
  device text not null default '',
  kind text not null,
  result jsonb not null,
  applied_at timestamptz not null default clock_timestamp(),
  applied_by text not null
);

-- an offline sale that could not be completed as made (a Room Charge refused when checked after reconnecting): for staff to settle
alter table outlet_bills add column offline_problem text;

-- a card payment taken offline on a reader (chip and PIN): at the hotel's risk until the reader forwards it; no refund before
alter table payments add column collected_offline boolean not null default false;
alter table payments add column forwarded_at timestamptz;
