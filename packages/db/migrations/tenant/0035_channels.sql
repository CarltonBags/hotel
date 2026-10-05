-- Channel manager connection and ARI outbox (ticket 37). Every change to rates, restrictions,
-- availability (reservations, Room Blocks, room assignments, rooms) and Supplements writes to the
-- outbox in the same transaction, through triggers, while the property is connected; the worker
-- pushes the current values of what changed.

create table channel_connections (
  property_id uuid primary key references properties(id),
  provider text not null,
  -- null while the connection is being made
  external_id text,
  connected_at timestamptz not null default now(),
  connected_by text not null,
  full_push_at timestamptz,
  -- a failing push: since when, why, and whether Revenue and the Property Manager were told
  failing_since timestamptz,
  last_error text,
  alerted_at timestamptz,
  -- one sync or push at a time per property: taken until this moment
  busy_until timestamptz,
  -- sales closed at the channels while the subscription is unpaid from day 60 (or the contract ended)
  closed_at timestamptz
);

-- the room types at the channel manager, and one external rate plan per (rate plan, room type) pair
create table channel_mappings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  room_type_id uuid not null references room_types(id),
  rate_plan_id uuid references rate_plans(id),
  external_id text not null,
  -- for a room type: the room count last sent; for a rate plan: the adult count its occupancy options were made for
  rooms integer,
  max_adults integer,
  created_at timestamptz not null default now()
);
create unique index channel_mappings_key on channel_mappings(room_type_id, coalesce(rate_plan_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table ari_outbox (
  id bigserial primary key,
  property_id uuid not null references properties(id),
  kind text not null constraint ari_outbox_kind_check check (kind in ('availability', 'restrictions')),
  room_type_id uuid not null references room_types(id),
  rate_plan_id uuid references rate_plans(id) on delete cascade,
  date_from date not null,
  date_to date not null,
  constraint ari_outbox_dates_check check (date_to >= date_from),
  created_at timestamptz not null default clock_timestamp(),
  -- taken by a push run; sent once the channel manager took it; refused when it said no for good
  claimed_at timestamptz,
  sent_at timestamptz,
  refused_at timestamptz,
  error text
);
create index ari_outbox_unsent_idx on ari_outbox(property_id, id) where sent_at is null and refused_at is null;

-- the days a full push covers; FULL_PUSH_DAYS in the domain says the same
create function ari_horizon_days() returns integer language sql immutable as $$ select 500 $$;

-- changed rows arrive as a transition table "changed"; one outbox row per (room type, rate plan) with the span of dates
create function ari_from_rates() returns trigger language plpgsql set search_path from current as $$
begin
  insert into ari_outbox (property_id, kind, room_type_id, rate_plan_id, date_from, date_to)
  select p.property_id, 'restrictions', c.room_type_id, c.rate_plan_id, min(c.date), max(c.date)
  from changed c join rate_plans p on p.id = c.rate_plan_id join channel_connections k on k.property_id = p.property_id
  group by p.property_id, c.room_type_id, c.rate_plan_id;
  return null;
end $$;

create function ari_from_reservations() returns trigger language plpgsql set search_path from current as $$
begin
  insert into ari_outbox (property_id, kind, room_type_id, date_from, date_to)
  select c.property_id, 'availability', c.room_type_id, min(c.arrival), max(c.departure) - 1
  from changed c join channel_connections k on k.property_id = c.property_id
  group by c.property_id, c.room_type_id;
  return null;
end $$;

create function ari_from_room_blocks() returns trigger language plpgsql set search_path from current as $$
begin
  insert into ari_outbox (property_id, kind, room_type_id, date_from, date_to)
  select c.property_id, 'availability', m.room_type_id, min(c.from_date), max(c.to_date) - 1
  from changed c join rooms m on m.id = c.room_id join channel_connections k on k.property_id = c.property_id
  where c.to_date > c.from_date
  group by c.property_id, m.room_type_id;
  return null;
end $$;

-- a stay holding an Out of Order room changes what is for sale
create function ari_from_room_assignments() returns trigger language plpgsql set search_path from current as $$
begin
  insert into ari_outbox (property_id, kind, room_type_id, date_from, date_to)
  select m.property_id, 'availability', m.room_type_id, min(c.from_date), max(c.to_date) - 1
  from changed c join rooms m on m.id = c.room_id join channel_connections k on k.property_id = m.property_id
  where c.to_date > c.from_date
  group by m.property_id, m.room_type_id;
  return null;
end $$;

-- a room added or removed: the whole horizon of its type
create function ari_from_rooms() returns trigger language plpgsql set search_path from current as $$
begin
  insert into ari_outbox (property_id, kind, room_type_id, date_from, date_to)
  select distinct c.property_id, 'availability', c.room_type_id, p.business_date, p.business_date + ari_horizon_days() - 1
  from changed c join properties p on p.id = c.property_id join channel_connections k on k.property_id = c.property_id;
  return null;
end $$;

-- a room moved to another type: both types (cleaning and other room changes do not count)
create function ari_from_room_move() returns trigger language plpgsql set search_path from current as $$
begin
  insert into ari_outbox (property_id, kind, room_type_id, date_from, date_to)
  select new.property_id, 'availability', t, p.business_date, p.business_date + ari_horizon_days() - 1
  from unnest(array[old.room_type_id, new.room_type_id]) t, properties p join channel_connections k on k.property_id = p.id
  where p.id = new.property_id;
  return null;
end $$;

-- a stay's dates, room type or status changed: the old and the new nights (notes and the like do not count)
create function ari_from_reservation_change() returns trigger language plpgsql set search_path from current as $$
begin
  insert into ari_outbox (property_id, kind, room_type_id, date_from, date_to)
  select new.property_id, 'availability', x.room_type_id, x.arrival, x.departure - 1
  from (values (old.room_type_id, old.arrival, old.departure), (new.room_type_id, new.arrival, new.departure)) x(room_type_id, arrival, departure)
  join channel_connections k on k.property_id = new.property_id;
  return null;
end $$;

-- Supplements set the prices of the other occupancies: the plan's whole horizon
create function ari_from_supplements() returns trigger language plpgsql set search_path from current as $$
begin
  insert into ari_outbox (property_id, kind, room_type_id, rate_plan_id, date_from, date_to)
  select distinct p.property_id, 'restrictions', rt.room_type_id, p.id, pr.business_date, pr.business_date + ari_horizon_days() - 1
  from changed c join rate_plans p on p.id = c.rate_plan_id join rate_plan_room_types rt on rt.rate_plan_id = p.id
  join properties pr on pr.id = p.property_id join channel_connections k on k.property_id = p.property_id;
  return null;
end $$;

create trigger rates_ari_insert after insert on rates referencing new table as changed for each statement execute function ari_from_rates();
create trigger rates_ari_update after update on rates referencing new table as changed for each statement execute function ari_from_rates();
create trigger rates_ari_delete after delete on rates referencing old table as changed for each statement execute function ari_from_rates();
create trigger restrictions_ari_insert after insert on restrictions referencing new table as changed for each statement execute function ari_from_rates();
create trigger restrictions_ari_update after update on restrictions referencing new table as changed for each statement execute function ari_from_rates();
create trigger restrictions_ari_delete after delete on restrictions referencing old table as changed for each statement execute function ari_from_rates();
create trigger reservations_ari_insert after insert on reservations referencing new table as changed for each statement execute function ari_from_reservations();
create trigger reservations_ari_update after update on reservations for each row
  when (old.status is distinct from new.status or old.arrival is distinct from new.arrival or old.departure is distinct from new.departure or old.room_type_id is distinct from new.room_type_id)
  execute function ari_from_reservation_change();
create trigger reservations_ari_delete after delete on reservations referencing old table as changed for each statement execute function ari_from_reservations();
create trigger room_blocks_ari_insert after insert on room_blocks referencing new table as changed for each statement execute function ari_from_room_blocks();
create trigger room_blocks_ari_update_new after update on room_blocks referencing new table as changed for each statement execute function ari_from_room_blocks();
create trigger room_blocks_ari_update_old after update on room_blocks referencing old table as changed for each statement execute function ari_from_room_blocks();
create trigger room_blocks_ari_delete after delete on room_blocks referencing old table as changed for each statement execute function ari_from_room_blocks();
create trigger room_assignments_ari_insert after insert on room_assignments referencing new table as changed for each statement execute function ari_from_room_assignments();
create trigger room_assignments_ari_update_new after update on room_assignments referencing new table as changed for each statement execute function ari_from_room_assignments();
create trigger room_assignments_ari_update_old after update on room_assignments referencing old table as changed for each statement execute function ari_from_room_assignments();
create trigger room_assignments_ari_delete after delete on room_assignments referencing old table as changed for each statement execute function ari_from_room_assignments();
create trigger rooms_ari_insert after insert on rooms referencing new table as changed for each statement execute function ari_from_rooms();
create trigger rooms_ari_update after update on rooms for each row when (old.room_type_id is distinct from new.room_type_id) execute function ari_from_room_move();
create trigger rooms_ari_delete after delete on rooms referencing old table as changed for each statement execute function ari_from_rooms();
create trigger rate_plan_supplements_ari_insert after insert on rate_plan_supplements referencing new table as changed for each statement execute function ari_from_supplements();
create trigger rate_plan_supplements_ari_update after update on rate_plan_supplements referencing new table as changed for each statement execute function ari_from_supplements();
create trigger rate_plan_supplements_ari_delete after delete on rate_plan_supplements referencing old table as changed for each statement execute function ari_from_supplements();
