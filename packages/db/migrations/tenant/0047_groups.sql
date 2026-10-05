-- Groups, Held Rooms, Tentative and Definite, release and Series (ticket 58).

-- a Group: the contract with an organiser (a Company or a person); its rooms are normal reservations linked to it
create table groups (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  name text not null constraint groups_name_check check (length(trim(name)) between 1 and 120),
  organiser_company_id uuid references companies(id),
  organiser_guest_id uuid references guests(id),
  contact text not null default '',
  status text not null default 'tentative' constraint groups_status_check check (status in ('tentative', 'definite', 'lapsed', 'cancelled')),
  -- a Tentative group lapses at its option date
  option_date date,
  -- the contract: terms and the reduction allowed without fee, as text (no automatic fee in v1)
  terms text not null default '',
  reduction_rules text not null default '',
  -- a Series repeats on a pattern of arrivals, one holding per departure
  series boolean not null default false,
  -- days before arrival a holding's release date falls on, by default
  release_days integer not null default 14 constraint groups_release_days_check check (release_days between 0 and 365),
  -- the group's prices: a hidden rate plan of its own, priced per room type and night, its Services included
  rate_plan_id uuid unique references rate_plans(id),
  created_by text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint groups_organiser_check check (organiser_company_id is null or organiser_guest_id is null)
);
create index groups_property_idx on groups(property_id, status);

-- one dated holding of a group (a Series has one per departure), with its own release date
create table group_holdings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  arrival date not null,
  departure date not null,
  release_date date not null,
  released_at timestamptz,
  warned_at timestamptz,
  constraint group_holdings_dates_check check (departure > arrival and release_date <= arrival)
);
create index group_holdings_group_idx on group_holdings(group_id, arrival);

-- Held Rooms: rooms per room type and night of a holding, before names are known
create table group_held_rooms (
  holding_id uuid not null references group_holdings(id) on delete cascade,
  room_type_id uuid not null references room_types(id),
  date date not null,
  rooms integer not null constraint group_held_rooms_rooms_check check (rooms between 0 and 999),
  primary key (holding_id, room_type_id, date)
);
create index group_held_rooms_type_idx on group_held_rooms(room_type_id, date);

-- a reservation booked for a group picks up its Held Rooms
alter table reservations add column group_holding_id uuid references group_holdings(id);
create index reservations_group_holding_idx on reservations(group_holding_id) where group_holding_id is not null;

-- a group's own rate plan is not one staff pick from the rates grid
alter table rate_plans add column group_id uuid;
