-- City Tax Rule, exemptions and the per-night record for filing (ticket 30).

-- charged on top as a City Tax Charge per guest-night, or absorbed by the hotel (no line, still filed)
alter table properties add column city_tax_pass_on text not null default 'on_top'
  constraint properties_city_tax_pass_on_check check (city_tax_pass_on in ('on_top', 'absorbed'));

-- fixed for a stay at check-in: a later change of the property's setting applies to later check-ins
alter table reservations add column city_tax_pass_on text
  constraint reservations_city_tax_pass_on_check check (city_tax_pass_on in ('on_top', 'absorbed'));

-- at most one rule per property; its versions decide which applies to a night
create table city_tax_rules (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  constraint city_tax_rules_property_key unique (property_id),
  name text not null,
  -- the preset it was copied from, so we can tell its properties when the law changes
  preset text constraint city_tax_rules_preset_check check (preset in ('berlin', 'hamburg', 'wien')),
  -- the Tax Code of the City Tax Charge (which one is right is for the tax advisor, gate 03)
  tax_code_id uuid not null references tax_codes(id),
  revenue_account text not null default '',
  created_at timestamptz not null default now(),
  created_by text not null
);

create table city_tax_rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references city_tax_rules(id),
  valid_from date not null,
  -- only for bookings made from this date; earlier bookings keep the previous version
  booked_from date,
  constraint city_tax_rule_versions_key unique nulls not distinct (rule_id, valid_from, booked_from),
  kind text not null constraint city_tax_rule_versions_kind_check check (kind in ('percentage', 'step_table', 'flat')),
  percent numeric(6, 3) constraint city_tax_rule_versions_percent_check check (percent >= 0 and percent <= 100),
  night_cap integer constraint city_tax_rule_versions_night_cap_check check (night_cap > 0),
  step_basis text not null default 'per_person' constraint city_tax_rule_versions_step_basis_check check (step_basis in ('per_person', 'per_room')),
  steps jsonb not null default '[]',
  beyond_every numeric(12, 2) constraint city_tax_rule_versions_beyond_check check (beyond_every > 0),
  beyond_amount numeric(12, 2),
  flat jsonb not null default '[]',
  constraint city_tax_rule_versions_percent_needed check (kind <> 'percentage' or percent is not null),
  created_at timestamptz not null default now(),
  created_by text not null
);

-- Services the property counts into the base besides the room (extra bed, final cleaning)
create table city_tax_base_services (
  rule_id uuid not null references city_tax_rules(id),
  service_id uuid not null references services(id),
  primary key (rule_id, service_id)
);

-- the exemption reasons the property enables, with the evidence each needs
create table city_tax_exemption_reasons (
  rule_id uuid not null references city_tax_rules(id),
  reason text not null constraint city_tax_exemption_reasons_reason_check check (reason in ('age', 'business_travel', 'resident', 'disability', 'long_stay', 'student', 'other')),
  primary key (rule_id, reason),
  evidence text not null default 'none' constraint city_tax_exemption_reasons_evidence_check check (evidence in ('none', 'note', 'document')),
  -- age: exempt under this age; long_stay: exempt after this many nights
  param integer constraint city_tax_exemption_reasons_param_check check (param > 0)
);

-- an exemption set per person on the reservation (person: adults first, then children in order)
create table reservation_city_tax_exemptions (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id),
  person integer not null constraint reservation_city_tax_exemptions_person_check check (person >= 0),
  constraint reservation_city_tax_exemptions_key unique (reservation_id, person),
  reason text not null constraint reservation_city_tax_exemptions_reason_check check (reason in ('business_travel', 'resident', 'disability', 'student', 'other')),
  note text not null default '',
  -- the evidence document; kept here until tenant file storage (ticket 36)
  document bytea,
  document_name text,
  document_type text,
  created_at timestamptz not null default now(),
  created_by text not null
);

-- the City Tax of each night of a checked-in stay, charged or absorbed: what the filing report sums
create table city_tax_nights (
  reservation_id uuid not null references reservations(id),
  date date not null,
  primary key (reservation_id, date),
  property_id uuid not null references properties(id),
  rule_id uuid not null references city_tax_rules(id),
  version_id uuid references city_tax_rule_versions(id),
  persons integer not null,
  taxable integer not null,
  base numeric(12, 2) not null,
  tax numeric(12, 2) not null,
  -- persons not taxed, by reason
  exempt jsonb not null default '{}',
  absorbed boolean not null,
  updated_at timestamptz not null default clock_timestamp()
);
create index city_tax_nights_property_date_idx on city_tax_nights(property_id, date);
