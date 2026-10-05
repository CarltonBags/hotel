-- Self Check-in on kiosk and phone (ticket 49).

-- the lobby QR a phone scans to say "I am at the hotel", and how the key is handed over
alter table properties add column self_checkin_token text not null default replace(gen_random_uuid()::text, '-', '');
alter table properties add column key_handover text not null default 'reception' constraint properties_key_handover_check check (key_handover in ('reception'));

-- one guest's run through Self Check-in, for the desk's live line; nothing the guest typed is kept here
create table self_checkins (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  reservation_id uuid not null references reservations(id) on delete cascade,
  channel text not null constraint self_checkins_channel_check check (channel in ('kiosk', 'phone')),
  device_id uuid,
  step text not null default 'stay' constraint self_checkins_step_check check (step in ('stay', 'register', 'pay', 'result')),
  outcome text constraint self_checkins_outcome_check check (outcome in ('checked_in', 'waiting', 'help')),
  reason text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index self_checkins_open_idx on self_checkins(property_id, updated_at) where finished_at is null;
