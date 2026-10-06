-- Subscription billing (ticket 88). Prices are configuration: a dated price list.
create table control.price_list (
  key text not null,
  valid_from date not null,
  primary key (key, valid_from),
  -- per room or per property and month, a percentage, or a VAT rate
  unit text not null constraint price_list_unit_check check (unit in ('room', 'property', 'percent')),
  amount numeric(12, 2) not null constraint price_list_amount_check check (amount >= 0),
  -- who of our staff set it (nobody: seeded with the platform)
  set_by text
);

-- who invoices the customers: the platform's own company (one row)
create table control.platform_seller (
  id boolean primary key default true constraint platform_seller_one check (id),
  name text not null,
  address_line1 text not null,
  postal_code text not null,
  city text not null,
  country text not null,
  vat_id text,
  tax_number text,
  iban text,
  bic text,
  -- the e-invoice names the seller's contact
  email text not null,
  phone text not null
);

-- the customer's terms and how they pay; account details stay with the payment provider (a mandate or card token and the last digits only)
create table control.subscriptions (
  tenant_id uuid primary key references control.tenants(id) on delete cascade,
  -- yearly prepayment of the base from this month's 1st on; null pays monthly
  yearly_from date,
  payment_method text not null default 'sepa' constraint subscriptions_method_check check (payment_method in ('sepa', 'card', 'transfer')),
  account_holder text,
  mandate_reference text,
  card_token text,
  account_last4 text,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- usage passed on at cost plus handling (SMS, WhatsApp messages)
create table control.usage_events (
  id bigserial primary key,
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  kind text not null,
  quantity integer not null constraint usage_events_quantity_check check (quantity > 0),
  cost numeric(12, 4) not null constraint usage_events_cost_check check (cost >= 0),
  at timestamptz not null default now()
);
create index usage_events_tenant_idx on control.usage_events(tenant_id, at);

-- rooms per property counted on the 1st (Out of Order rooms count)
create table control.room_counts (
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  property_id uuid not null,
  month date not null,
  rooms integer not null,
  primary key (tenant_id, property_id, month)
);

-- the monthly invoice per Legal Entity of the customer, numbered without gaps
create table control.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  legal_entity_id uuid not null,
  month date not null,
  constraint subscription_invoices_once unique (tenant_id, legal_entity_id, month),
  number text not null unique,
  document jsonb not null,
  pdf bytea,
  xml text,
  issued_at timestamptz not null default now()
);
create table control.counters (
  key text primary key,
  last integer not null default 0
);
