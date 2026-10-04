-- Housekeeping Tasks, rhythms and the supervisor board (ticket 34).

-- the property's rules: Stayover clean rhythm, Linen change every N nights, shift length of a housekeeper
alter table properties add column hk_stayover_rhythm text not null default 'daily'
  constraint properties_hk_stayover_rhythm_check check (hk_stayover_rhythm in ('daily', 'every_2', 'every_3', 'on_request'));
alter table properties add column hk_linen_every integer default 3 constraint properties_hk_linen_every_check check (hk_linen_every > 0);
alter table properties add column hk_shift_minutes integer not null default 480 constraint properties_hk_shift_minutes_check check (hk_shift_minutes > 0);
-- a room type may follow its own rhythms (null: the property's)
alter table room_types add column hk_stayover_rhythm text
  constraint room_types_hk_stayover_rhythm_check check (hk_stayover_rhythm in ('daily', 'every_2', 'every_3', 'on_request'));
-- 0: no linen change for this room type
alter table room_types add column hk_linen_every integer constraint room_types_hk_linen_every_check check (hk_linen_every >= 0);

-- minutes a task takes in a room of the type (missing: the defaults)
create table housekeeping_minutes (
  room_type_id uuid not null references room_types(id) on delete cascade,
  kind text not null constraint housekeeping_minutes_kind_check check (kind in ('departure', 'stayover', 'arrival', 'linen', 'clean')),
  primary key (room_type_id, kind),
  minutes integer not null constraint housekeeping_minutes_minutes_check check (minutes > 0 and minutes <= 600)
);

-- the day's tasks: kind, minutes, the stay, and their state on the published plan
alter table housekeeping_tasks add constraint housekeeping_tasks_kind_check check (kind in ('departure', 'stayover', 'arrival', 'linen', 'clean'));
alter table housekeeping_tasks add column minutes integer not null default 20;
alter table housekeeping_tasks add column reservation_id uuid references reservations(id);
-- changed after the plan was published (the phone marks it)
alter table housekeeping_tasks add column changed boolean not null default false;
alter table housekeeping_tasks add column note text not null default '';
alter table housekeeping_tasks add column started_at timestamptz;
alter table housekeeping_tasks add column done_at timestamptz;
alter table housekeeping_tasks add column done_by text;
-- a guest Arrived and Waiting for Room: the room comes first
alter table housekeeping_tasks add column priority boolean not null default false;
create index housekeeping_tasks_reservation_idx on housekeeping_tasks(reservation_id);

-- the guest is here and waits for the room (Arrived, Waiting for Room)
alter table reservations add column waiting_for_room_since timestamptz;

-- the day's plan: a draft until the supervisor publishes it to the housekeepers
create table housekeeping_plans (
  property_id uuid not null references properties(id),
  business_date date not null,
  primary key (property_id, business_date),
  published_at timestamptz,
  published_by text
);

-- a failed inspection turns the room Dirty again
alter table room_cleanliness_changes drop constraint room_cleanliness_changes_source_check;
alter table room_cleanliness_changes add constraint room_cleanliness_changes_source_check
  check (source in ('manual', 'check_out', 'room_move', 'block_end', 'night_audit', 'inspection'));
alter table room_cleanliness_changes add column reason text not null default '';
