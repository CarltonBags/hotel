-- Tax Codes per Legal Entity with dated rates, and the Service catalogue per property
-- (decisions in "Folio, billing and invoicing domain model", ADR 0010). Built in ticket 16.

create table tax_codes (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id),
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (legal_entity_id, code)
);

-- The rate in force on a date is the latest row with valid_from on or before it.
-- Rows are never changed once a charge may reference the date; a new rate is a new row.
create table tax_code_rates (
  id uuid primary key default gen_random_uuid(),
  tax_code_id uuid not null references tax_codes(id) on delete cascade,
  valid_from date not null,
  rate numeric(5, 2) not null check (rate >= 0 and rate <= 100),
  unique (tax_code_id, valid_from)
);

create table services (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  code text not null,
  name text not null,
  names jsonb not null default '{}'::jsonb,
  default_price numeric(12, 2) not null check (default_price >= 0),
  tax_code_id uuid not null references tax_codes(id),
  revenue_account text not null default '',
  posting_rhythm text not null check (posting_rhythm in ('once', 'per_night', 'per_person_night')),
  bookable_online boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, code)
);
create index services_property_idx on services(property_id, sort_order);
