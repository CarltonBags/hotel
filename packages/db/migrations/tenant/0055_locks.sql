-- Door locks (ticket 67): one lock interface with a Lock Plugin per vendor; keys only for Checked-in stays.

-- the property's lock system and how keys are handed over
create table property_locks (
  property_id uuid primary key references properties(id),
  -- 'other': a system without a plugin yet, keys made in its own software
  system text not null default 'none' constraint property_locks_system_check check (system in ('none', 'simulated', 'nuki', 'other')),
  other_name text not null default '' constraint property_locks_other_name_check check (length(other_name) <= 60),
  handover text not null default 'reception' constraint property_locks_handover_check check (handover in ('reception', 'kiosk_encoder', 'digital_key', 'door_pin')),
  -- a key runs to check-out time plus this
  grace_minutes integer not null default 60 constraint property_locks_grace_check check (grace_minutes between 0 and 720),
  -- the lock system's credential (Nuki's API token), sealed
  secret_sealed text,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by text not null
);

-- a room's door at the lock system
create table lock_doors (
  room_id uuid primary key references rooms(id) on delete cascade,
  lock_ref text not null constraint lock_doors_lock_ref_check check (length(trim(lock_ref)) between 1 and 100)
);

-- the encoder a desk workstation (an enrolled Device) writes key cards on
create table lock_encoders (
  device_id uuid primary key,
  property_id uuid not null references properties(id),
  encoder_id text not null constraint lock_encoders_encoder_id_check check (length(trim(encoder_id)) between 1 and 100)
);

create table room_keys (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id),
  room_id uuid not null references rooms(id),
  kind text not null constraint room_keys_kind_check check (kind in ('card', 'pin', 'phone')),
  -- the key's id at the lock system
  external_id text,
  -- a door PIN, sealed
  pin_sealed text,
  encoder_id text,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  status text not null default 'pending' constraint room_keys_status_check check (status in ('pending', 'active', 'revoked', 'failed')),
  error text,
  issued_at timestamptz not null default clock_timestamp(),
  issued_by text not null,
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  constraint room_keys_valid_check check (valid_until > valid_from)
);
create index room_keys_reservation_idx on room_keys(reservation_id);

-- every key event of a stay, shown on the reservation
create table key_events (
  id bigserial primary key,
  reservation_id uuid not null references reservations(id),
  room_key_id uuid references room_keys(id),
  action text not null,
  detail jsonb not null default '{}',
  at timestamptz not null default clock_timestamp(),
  by text not null
);
create index key_events_reservation_idx on key_events(reservation_id, at);

-- stays whose keys the worker brings in line with where they stand (check-in, extension, room move, check-out, no-show, cancellation)
create table lock_sync (
  reservation_id uuid primary key references reservations(id),
  next_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0,
  error text
);

-- any change of a stay's status, dates or rooms queues it, whatever path made the change; only where a plugin runs the locks
create function queue_lock_sync(reservation uuid) returns void language sql set search_path from current as $$
  insert into lock_sync (reservation_id)
  select r.id from reservations r join property_locks l on l.property_id = r.property_id
  where r.id = reservation and l.system in ('simulated', 'nuki')
  on conflict (reservation_id) do update set next_at = clock_timestamp(), attempts = 0, error = null;
$$;

create function reservations_lock_sync() returns trigger language plpgsql set search_path from current as $$
begin
  perform queue_lock_sync(new.id);
  return null;
end $$;
create trigger reservations_lock_sync after update of status, arrival, departure on reservations for each row
  when (old.status is distinct from new.status or old.departure is distinct from new.departure or old.arrival is distinct from new.arrival)
  execute function reservations_lock_sync();

create function room_assignments_lock_sync() returns trigger language plpgsql set search_path from current as $$
begin
  perform queue_lock_sync(coalesce(new.reservation_id, old.reservation_id));
  return null;
end $$;
create trigger room_assignments_lock_sync after insert or update or delete on room_assignments for each row execute function room_assignments_lock_sync();

-- a new Business Date: stays in house may change doors tonight (a room move from this night on)
create function properties_lock_sync() returns trigger language plpgsql set search_path from current as $$
begin
  perform queue_lock_sync(r.id) from reservations r where r.property_id = new.id and r.status = 'checked_in';
  return null;
end $$;
create trigger properties_lock_sync after update of business_date on properties for each row
  when (old.business_date is distinct from new.business_date)
  execute function properties_lock_sync();
