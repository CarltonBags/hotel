-- Room Types, Rooms, Room Features and Sections (decisions in "Reservation and inventory domain model" and
-- "Housekeeping model"), Age Bands ("Rates and restrictions model"), per-room capacity history
-- ("Tourism statistics reporting duties"). Built in ticket 15.

create table room_types (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  code text not null,
  -- name in the property's main language; names holds versions per guest language
  name text not null,
  names jsonb not null default '{}'::jsonb,
  max_occupancy integer not null check (max_occupancy >= 1),
  max_adults integer not null check (max_adults >= 1),
  -- defaults for new rooms of this type
  bed_places integer not null default 2 check (bed_places >= 0),
  extra_beds integer not null default 0 check (extra_beds >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, code)
);

create table sections (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  name text not null,
  sort_order integer not null default 0,
  unique (property_id, name)
);

create table room_features (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  code text not null,
  name text not null,
  names jsonb not null default '{}'::jsonb,
  unique (property_id, code)
);

create table rooms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  room_type_id uuid not null references room_types(id),
  number text not null,
  -- optional name beside the number ("Suite Bellevue"), with versions per guest language
  name text not null default '',
  names jsonb not null default '{}'::jsonb,
  floor text not null default '',
  section_id uuid references sections(id) on delete set null,
  -- current statistical capacity; the dated history is in room_capacity_history
  bed_places integer not null check (bed_places >= 0),
  extra_beds integer not null check (extra_beds >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, number)
);
create index rooms_property_type_idx on rooms(property_id, room_type_id);

create table room_feature_assignments (
  room_id uuid not null references rooms(id) on delete cascade,
  feature_id uuid not null references room_features(id) on delete cascade,
  primary key (room_id, feature_id)
);

-- Bed places and extra beds per room over time, for the official tourism statistics.
create table room_capacity_history (
  id bigserial primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  valid_from date not null,
  bed_places integer not null check (bed_places >= 0),
  extra_beds integer not null check (extra_beds >= 0),
  unique (room_id, valid_from)
);

create table age_bands (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  name text not null,
  min_age integer not null check (min_age >= 0),
  max_age integer check (max_age is null or max_age >= min_age),
  sort_order integer not null default 0
);
create index age_bands_property_idx on age_bands(property_id, min_age);
