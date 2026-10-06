-- Spa appointment book and spa sales (ticket 63); guest self-booking follows (ticket 64).

-- who gives treatments at a spa outlet, and the rooms they are given in
create table spa_therapists (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id) on delete cascade,
  name text not null constraint spa_therapists_name_check check (length(trim(name)) between 1 and 60),
  active boolean not null default true,
  constraint spa_therapists_outlet_id_name_key unique (outlet_id, name)
);

create table spa_rooms (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id) on delete cascade,
  name text not null constraint spa_rooms_name_check check (length(trim(name)) between 1 and 60),
  active boolean not null default true,
  constraint spa_rooms_outlet_id_name_key unique (outlet_id, name)
);

-- a treatment: an item of the spa's menu (its Service, Tax Code and price) with how long it takes
create table spa_treatments (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id) on delete cascade,
  menu_item_id uuid not null references outlet_menu_items(id),
  minutes integer not null constraint spa_treatments_minutes_check check (minutes between 5 and 480),
  -- given in a treatment room (a massage), or not (a manicure at the counter)
  needs_room boolean not null default true,
  active boolean not null default true,
  constraint spa_treatments_menu_item_key unique (menu_item_id)
);

-- when a therapist works: appointments are booked inside these hours; released hours are open to guests (ticket 64)
create table spa_hours (
  id uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references spa_therapists(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  released boolean not null default false,
  constraint spa_hours_range_check check (ends_at > starts_at)
);
create index spa_hours_therapist_idx on spa_hours(therapist_id, starts_at);

-- an appointment: a treatment by a therapist (in a room) for a hotel guest's stay or a day visitor
create table spa_appointments (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id),
  treatment_id uuid not null references spa_treatments(id),
  therapist_id uuid not null references spa_therapists(id),
  room_id uuid references spa_rooms(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reservation_id uuid references reservations(id),
  -- a day visitor (or the guest's own words for the booking)
  guest_name text not null default '',
  note text not null default '',
  status text not null default 'booked' constraint spa_appointments_status_check check (status in ('booked', 'done', 'cancelled', 'no_show')),
  -- the bill it was sold on
  bill_id uuid references outlet_bills(id),
  booked_via text not null default 'staff' constraint spa_appointments_via_check check (booked_via in ('staff', 'portal')),
  booked_by text not null,
  booked_at timestamptz not null default clock_timestamp(),
  cancelled_at timestamptz,
  cancelled_by text,
  constraint spa_appointments_range_check check (ends_at > starts_at),
  constraint spa_appointments_who_check check (reservation_id is not null or length(trim(guest_name)) > 0)
);
create index spa_appointments_therapist_idx on spa_appointments(therapist_id, starts_at) where status <> 'cancelled';
create index spa_appointments_room_idx on spa_appointments(room_id, starts_at) where status <> 'cancelled' and room_id is not null;
create index spa_appointments_reservation_idx on spa_appointments(reservation_id) where reservation_id is not null;
