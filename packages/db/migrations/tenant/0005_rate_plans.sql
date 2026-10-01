-- Rate Plans, policies, Supplements, Rates and Restrictions (ticket 17, ADR 0012).
-- Money is gross in the property currency (ADR 0010).

alter table room_types add column price_floor numeric(12, 2) constraint room_types_price_floor_check check (price_floor is null or price_floor >= 0);

create table payment_policies (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  name text not null,
  kind text not null constraint payment_policies_kind_check check (kind in ('full', 'deposit_percent', 'deposit_first_night', 'card_guarantee', 'none')),
  deposit_percent numeric(5, 2) constraint payment_policies_deposit_percent_check check (deposit_percent is null or (deposit_percent > 0 and deposit_percent <= 100)),
  constraint payment_policies_deposit_kind_check check ((kind = 'deposit_percent') = (deposit_percent is not null)),
  created_at timestamptz not null default now(),
  unique (property_id, name)
);

create table cancellation_policies (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  name text not null,
  -- null: never free. Otherwise free until this many days before arrival, at free_until_time property-local.
  free_until_days integer constraint cancellation_policies_free_until_days_check check (free_until_days is null or free_until_days >= 0),
  free_until_time time not null default '18:00',
  fee_kind text not null constraint cancellation_policies_fee_kind_check check (fee_kind in ('none', 'first_night', 'percent', 'full_stay')),
  fee_percent numeric(5, 2) constraint cancellation_policies_fee_percent_check check (fee_percent is null or (fee_percent > 0 and fee_percent <= 100)),
  no_show_fee_kind text not null constraint cancellation_policies_no_show_fee_kind_check check (no_show_fee_kind in ('none', 'first_night', 'percent', 'full_stay')),
  no_show_fee_percent numeric(5, 2) constraint cancellation_policies_no_show_fee_percent_check check (no_show_fee_percent is null or (no_show_fee_percent > 0 and no_show_fee_percent <= 100)),
  constraint cancellation_policies_fee_pair_check check ((fee_kind = 'percent') = (fee_percent is not null)),
  constraint cancellation_policies_no_show_fee_pair_check check ((no_show_fee_kind = 'percent') = (no_show_fee_percent is not null)),
  created_at timestamptz not null default now(),
  unique (property_id, name)
);

create table rate_plans (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  code text not null,
  name text not null,
  names jsonb not null default '{}'::jsonb,
  descriptions jsonb not null default '{}'::jsonb,
  policy_texts jsonb not null default '{}'::jsonb,
  -- base: prices entered; derived: prices follow base_plan_id (one level, enforced in the repository)
  kind text not null constraint rate_plans_kind_check check (kind in ('base', 'derived')),
  base_plan_id uuid references rate_plans(id),
  derivation_kind text constraint rate_plans_derivation_kind_check check (derivation_kind in ('amount', 'percent')),
  derivation_value numeric(12, 2),
  -- per restriction field: does the derived plan take it from the base
  inherits jsonb not null default '{}'::jsonb,
  constraint rate_plans_derived_check check ((kind = 'derived') = (base_plan_id is not null and derivation_kind is not null and derivation_value is not null)),
  base_occupancy integer not null default 2 constraint rate_plans_base_occupancy_check check (base_occupancy >= 1),
  meal_plan text not null default 'none' constraint rate_plans_meal_plan_check check (meal_plan in ('none', 'breakfast', 'half_board', 'full_board')),
  payment_policy_id uuid not null references payment_policies(id),
  cancellation_policy_id uuid not null references cancellation_policies(id),
  date_change_allowed boolean not null default true,
  early_departure_fee_kind text not null default 'none' constraint rate_plans_early_departure_fee_kind_check check (early_departure_fee_kind in ('none', 'first_night', 'percent', 'full_stay')),
  early_departure_fee_percent numeric(5, 2) constraint rate_plans_early_departure_fee_percent_check check (early_departure_fee_percent is null or (early_departure_fee_percent > 0 and early_departure_fee_percent <= 100)),
  constraint rate_plans_early_departure_fee_pair_check check ((early_departure_fee_kind = 'percent') = (early_departure_fee_percent is not null)),
  -- public, or hidden behind a Rate Code; a Rate Code may attach a Company (ticket 20 adds the link)
  public boolean not null default true,
  rate_code text,
  constraint rate_plans_rate_code_check check (public or rate_code is not null),
  sold_on_channels boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, code)
);
create index rate_plans_property_idx on rate_plans(property_id, sort_order);
create index rate_plans_base_idx on rate_plans(base_plan_id) where base_plan_id is not null;

create table rate_plan_room_types (
  rate_plan_id uuid not null references rate_plans(id) on delete cascade,
  room_type_id uuid not null references room_types(id),
  primary key (rate_plan_id, room_type_id)
);

create table rate_plan_supplements (
  id uuid primary key default gen_random_uuid(),
  rate_plan_id uuid not null references rate_plans(id) on delete cascade,
  kind text not null constraint rate_plan_supplements_kind_check check (kind in ('single', 'extra_adult', 'child')),
  age_band_id uuid references age_bands(id),
  constraint rate_plan_supplements_age_band_check check ((kind = 'child') = (age_band_id is not null)),
  amount numeric(12, 2) not null
);
create unique index rate_plan_supplements_key on rate_plan_supplements(rate_plan_id, kind, coalesce(age_band_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- included Services with a fixed component price per person-night; the room receives the remainder
create table rate_plan_services (
  rate_plan_id uuid not null references rate_plans(id) on delete cascade,
  service_id uuid not null references services(id),
  component_price numeric(12, 2) not null constraint rate_plan_services_component_price_check check (component_price >= 0),
  primary key (rate_plan_id, service_id)
);

-- the Rate: one plan, one room type, one date, gross at base occupancy; derived plans' values are stored too
create table rates (
  rate_plan_id uuid not null references rate_plans(id) on delete cascade,
  room_type_id uuid not null references room_types(id),
  date date not null,
  price numeric(12, 2) not null constraint rates_price_check check (price >= 0),
  primary key (rate_plan_id, room_type_id, date)
);

create table restrictions (
  rate_plan_id uuid not null references rate_plans(id) on delete cascade,
  room_type_id uuid not null references room_types(id),
  date date not null,
  stop_sell boolean not null default false,
  closed_to_arrival boolean not null default false,
  closed_to_departure boolean not null default false,
  min_stay_arrival integer constraint restrictions_min_stay_arrival_check check (min_stay_arrival is null or min_stay_arrival >= 1),
  min_stay_through integer constraint restrictions_min_stay_through_check check (min_stay_through is null or min_stay_through >= 1),
  max_stay integer constraint restrictions_max_stay_check check (max_stay is null or max_stay >= 1),
  primary key (rate_plan_id, room_type_id, date)
);

-- every rate and restriction change, per cell, grouped by change_id for undo (ticket 18)
create table rate_changes (
  id uuid primary key default gen_random_uuid(),
  change_id uuid not null,
  property_id uuid not null references properties(id),
  user_id text not null,
  at timestamptz not null default now(),
  rate_plan_id uuid not null references rate_plans(id) on delete cascade,
  room_type_id uuid not null references room_types(id),
  date date not null,
  field text not null,
  old_value text,
  new_value text,
  -- 'derived' when written because a base price changed
  reason text not null default 'edit'
);
create index rate_changes_change_idx on rate_changes(change_id);
create index rate_changes_property_idx on rate_changes(property_id, at desc);
