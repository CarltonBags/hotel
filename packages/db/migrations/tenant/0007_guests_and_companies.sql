-- Guest profiles (tenant-wide, ADR 0004) and Companies (ticket 20).

create table guests (
  id uuid primary key default gen_random_uuid(),
  first_name text not null default '',
  last_name text not null,
  date_of_birth date,
  nationality char(2),
  -- tourism statistics: every guest, separately from nationality
  country_of_residence char(2),
  postal_code text,
  address_line1 text not null default '',
  city text not null default '',
  email text,
  phone text,
  -- normalised copies for duplicate detection and search
  email_normalised text,
  phone_normalised text,
  language text,
  preferences text not null default '',
  vip boolean not null default false,
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  marketing_consent_source text,
  constraint guests_consent_proof_check check (not marketing_consent or (marketing_consent_at is not null and marketing_consent_source is not null)),
  document_type text constraint guests_document_type_check check (document_type in ('passport', 'id_card', 'driving_licence', 'other')),
  document_number text,
  document_country char(2),
  document_expiry date,
  created_at timestamptz not null default now(),
  created_by text not null,
  created_property_id uuid references properties(id),
  updated_at timestamptz not null default now()
);
create index guests_email_idx on guests(email_normalised) where email_normalised is not null;
create index guests_phone_idx on guests(phone_normalised) where phone_normalised is not null;
create index guests_name_idx on guests(lower(last_name), lower(first_name));

-- change history of a profile, shown to anyone who may view it
create table guest_changes (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references guests(id) on delete cascade,
  user_id text not null,
  at timestamptz not null default clock_timestamp(),
  field text not null,
  old_value text,
  new_value text
);
create index guest_changes_guest_idx on guest_changes(guest_id, at desc);

-- merges: no foreign keys, the merged profile is gone afterwards; no personal data, only ids and field names
create table guest_merges (
  id uuid primary key default gen_random_uuid(),
  kept_id uuid not null,
  merged_id uuid not null,
  user_id text not null,
  at timestamptz not null default now(),
  filled_fields text[] not null default '{}',
  moved_records integer not null default 0
);
create index guest_merges_kept_idx on guest_merges(kept_id);

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vat_id text,
  address_line1 text not null default '',
  address_line2 text not null default '',
  postal_code text not null default '',
  city text not null default '',
  country char(2),
  billing_email text,
  phone text,
  contact_person text not null default '',
  payment_terms_days integer not null default 14 constraint companies_payment_terms_check check (payment_terms_days between 0 and 365),
  -- invoices may be issued unpaid and become Receivables
  on_account boolean not null default false,
  -- default Routing Rules: which charge categories go to the Company's folio
  routing text[] not null default '{}' constraint companies_routing_check check (routing <@ array['accommodation', 'package', 'extras', 'city_tax']::text[]),
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text not null,
  updated_at timestamptz not null default now()
);
create index companies_name_idx on companies(lower(name));

-- change history of a Company (matrix: every record shows its change history)
create table company_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id text not null,
  at timestamptz not null default clock_timestamp(),
  field text not null,
  old_value text,
  new_value text
);
create index company_changes_company_idx on company_changes(company_id, at desc);

-- "a Rate Code may attach a Company" (rates model), deferred from ticket 17
alter table rate_plans add column company_id uuid references companies(id);
