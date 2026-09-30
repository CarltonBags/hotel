-- Legal Entity (ADR 0002): the invoice-issuing company. Property belongs to exactly one.
create table legal_entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address_line1 text not null default '',
  address_line2 text not null default '',
  postal_code text not null default '',
  city text not null default '',
  country char(2) not null,
  vat_id text not null default '',
  iban text not null default '',
  bic text not null default '',
  account_holder text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id),
  name text not null,
  country char(2) not null,
  time_zone text not null,
  currency char(3) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index properties_legal_entity_idx on properties(legal_entity_id);
