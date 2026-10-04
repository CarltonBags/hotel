-- The phone view for floor staff (ticket 35): versions for offline changes, Housekeeping Notes,
-- the minibar, Maintenance Issues and Lost and Found as reported from the phone.

-- A task's version goes up with every change not made from the housekeeper's phone, so a change
-- made offline against an older version loses to the supervisor's newer one.
alter table housekeeping_tasks add column version integer not null default 0;
create function housekeeping_tasks_version() returns trigger language plpgsql set search_path from current as $$
begin
  if coalesce(current_setting('hoteloftware.phone_change', true), '') <> 'on'
     and (new.status, new.assignee_id, new.kind, new.priority, new.note, new.minutes, new.changed)
         is distinct from (old.status, old.assignee_id, old.kind, old.priority, old.note, old.minutes, old.changed) then
    new.version := old.version + 1;
  end if;
  return new;
end $$;
create trigger housekeeping_tasks_version before update on housekeeping_tasks for each row execute function housekeeping_tasks_version();
-- why a stayover or linen task was skipped
alter table housekeeping_tasks add column skip_reason text constraint housekeeping_tasks_skip_reason_check check (skip_reason in ('declined', 'dnd'));

-- remarks for floor staff on a reservation: from the property's fixed list, or free text
create table housekeeping_notes (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  code text constraint housekeeping_notes_code_check check (code in ('feather_allergy', 'baby_cot', 'extra_bed', 'welcome_gift', 'late_checkout', 'pet', 'accessibility')),
  text text,
  constraint housekeeping_notes_one_check check ((code is null) <> (text is null)),
  created_at timestamptz not null default clock_timestamp(),
  created_by text not null
);
create index housekeeping_notes_reservation_idx on housekeeping_notes(reservation_id);

-- Services counted on the room sheet's minibar
alter table services add column minibar boolean not null default false;

-- a reported defect; worked by Maintenance (the full workflow and file storage come with ticket 36)
create table maintenance_issues (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  room_id uuid references rooms(id),
  place text not null default '',
  constraint maintenance_issues_place_check check (room_id is not null or length(trim(place)) > 0),
  pick text not null constraint maintenance_issues_pick_check check (pick in ('plumbing', 'electrical', 'heating', 'furniture', 'door', 'other')),
  urgency text not null constraint maintenance_issues_urgency_check check (urgency in ('now', 'today', 'later')),
  note text not null default '',
  photo bytea,
  photo_type text,
  status text not null default 'open' constraint maintenance_issues_status_check check (status in ('open', 'in_progress', 'done')),
  reported_at timestamptz not null default clock_timestamp(),
  reported_by text not null,
  taken_at timestamptz,
  taken_by text,
  fixed_at timestamptz,
  fixed_by text,
  fix_note text not null default ''
);
create index maintenance_issues_open_idx on maintenance_issues(property_id) where status <> 'done';

-- an item found in a room
create table lost_items (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  room_id uuid not null references rooms(id),
  pick text not null constraint lost_items_pick_check check (pick in ('clothing', 'electronics', 'documents', 'valuables', 'other')),
  note text not null default '',
  photo bytea,
  photo_type text,
  found_at timestamptz not null,
  found_by text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  status text not null default 'kept' constraint lost_items_status_check check (status in ('kept', 'returned', 'disposed'))
);
create index lost_items_property_idx on lost_items(property_id, found_at desc);

-- every change a phone sent, once: sending it again returns the first answer
create table phone_changes (
  id uuid primary key,
  user_id text not null,
  kind text not null,
  made_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  outcome text not null constraint phone_changes_outcome_check check (outcome in ('applied', 'conflict', 'refused')),
  message text not null default ''
);
