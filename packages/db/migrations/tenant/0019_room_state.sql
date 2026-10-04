-- Room state, Room Blocks and the room picker (ticket 33, ADR 0011).

-- Cleanliness, set by staff (Occupancy is derived from reservations, never stored)
-- a new room starts ready for a guest
alter table rooms add column cleanliness text not null default 'inspected'
  constraint rooms_cleanliness_check check (cleanliness in ('dirty', 'clean', 'inspected'));
alter table rooms add column cleanliness_at timestamptz;
alter table rooms add column cleanliness_by text;

-- every change of a room's Cleanliness, by hand or by the system (check-out, room move, block end, Night Audit)
create table room_cleanliness_changes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  property_id uuid not null references properties(id),
  before text not null,
  after text not null,
  source text not null constraint room_cleanliness_changes_source_check check (source in ('manual', 'check_out', 'room_move', 'block_end', 'night_audit')),
  user_id text not null,
  at timestamptz not null default clock_timestamp(),
  business_date date not null
);
create index room_cleanliness_changes_room_idx on room_cleanliness_changes(room_id, at desc);
create trigger room_cleanliness_changes_business_date before insert on room_cleanliness_changes for each row execute function stamp_business_date();

-- only Inspected rooms are ready for a guest; without inspection Clean is enough
alter table properties add column inspection_required boolean not null default true;

-- a dated restriction on a room: Out of Order (not for sale) or Out of Service (sellable, flagged)
create table room_blocks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  room_id uuid not null references rooms(id),
  kind text not null constraint room_blocks_kind_check check (kind in ('out_of_order', 'out_of_service')),
  -- first night blocked, and the day after the last
  from_date date not null,
  to_date date not null,
  -- a block cancelled before it began ends on its first day (no night)
  constraint room_blocks_dates_check check (to_date >= from_date),
  reason text not null constraint room_blocks_reason_check check (length(trim(reason)) > 0),
  created_at timestamptz not null default clock_timestamp(),
  created_by text not null,
  ended_at timestamptz,
  ended_by text
);
create index room_blocks_room_idx on room_blocks(room_id, from_date);
create index room_blocks_property_idx on room_blocks(property_id, kind, from_date, to_date);

-- a Housekeeping Task for a room on a Business Date; its assignee's rooms are the Housekeeper's own (ticket 34 adds kinds, minutes and generation)
create table housekeeping_tasks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  room_id uuid not null references rooms(id),
  business_date date not null,
  kind text not null default 'clean',
  assignee_id text,
  status text not null default 'open' constraint housekeeping_tasks_status_check check (status in ('open', 'in_progress', 'done', 'skipped')),
  created_at timestamptz not null default clock_timestamp(),
  created_by text not null,
  constraint housekeeping_tasks_key unique (room_id, business_date, kind)
);
create index housekeeping_tasks_assignee_idx on housekeeping_tasks(property_id, business_date, assignee_id);
