-- Bookings, Reservations and their stored nightly prices (ticket 21, ADR 0003).

-- confirmation numbers are short and counted per tenant; a sequence is the right tool here
create sequence booking_number_seq start with 100001;

create table bookings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  confirmation_number text not null unique default nextval('booking_number_seq')::text,
  -- the Booker is a person or a Company, billed by default
  booker_guest_id uuid references guests(id),
  booker_company_id uuid references companies(id),
  constraint bookings_booker_check check ((booker_guest_id is null) <> (booker_company_id is null)),
  source text not null default 'direct' constraint bookings_source_check check (source in ('direct', 'channel')),
  channel_name text,
  walk_in boolean not null default false,
  constraint bookings_walk_in_check check (not walk_in or source = 'direct'),
  rate_code text,
  -- the Company a corporate Rate Code attaches, kept even when a person is the Booker
  rate_code_company_id uuid references companies(id),
  notes text not null default '',
  created_at timestamptz not null default now(),
  created_by text not null
);
create index bookings_property_idx on bookings(property_id, created_at desc);

create table reservations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id),
  property_id uuid not null references properties(id),
  room_type_id uuid not null references room_types(id),
  rate_plan_id uuid not null references rate_plans(id),
  arrival date not null,
  departure date not null,
  constraint reservations_dates_check check (departure > arrival),
  adults integer not null constraint reservations_adults_check check (adults >= 1),
  child_ages integer[] not null default '{}',
  status text not null default 'confirmed' constraint reservations_status_check check (status in ('confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')),
  primary_guest_id uuid not null references guests(id),
  -- wall clock, so the rooms of one booking keep the order they were entered in
  created_at timestamptz not null default clock_timestamp(),
  created_by text not null
);
create index reservations_booking_idx on reservations(booking_id);
-- Availability: reservations of a room type overlapping a date range
create index reservations_availability_idx on reservations(property_id, room_type_id, arrival, departure) where status in ('confirmed', 'checked_in');
create index reservations_guest_idx on reservations(primary_guest_id);

-- the price of each night, stored at booking and never changed by later rate changes
create table reservation_nights (
  reservation_id uuid not null references reservations(id) on delete cascade,
  date date not null,
  total numeric(12, 2) not null constraint reservation_nights_total_check check (total >= 0),
  primary key (reservation_id, date)
);

-- components of a night: the room remainder and included Services per person
create table reservation_night_components (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null,
  date date not null,
  foreign key (reservation_id, date) references reservation_nights(reservation_id, date) on delete cascade,
  kind text not null constraint reservation_night_components_kind_check check (kind in ('room', 'service')),
  service_id uuid references services(id),
  constraint reservation_night_components_service_check check ((kind = 'service') = (service_id is not null)),
  persons integer,
  unit_price numeric(12, 2) not null,
  amount numeric(12, 2) not null constraint reservation_night_components_amount_check check (amount >= 0)
);
create index reservation_night_components_night_idx on reservation_night_components(reservation_id, date);
