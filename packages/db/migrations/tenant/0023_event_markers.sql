-- Event Markers (ticket 19): named dates or date ranges a property marks as special (fair, holiday,
-- concert), shown in the Rates grid header, the bulk range picker and the Calendar.
create table event_markers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  name text not null constraint event_markers_name_check check (length(trim(name)) between 1 and 60),
  -- both days included
  from_date date not null,
  to_date date not null,
  constraint event_markers_dates_check check (to_date >= from_date and to_date - from_date < 366),
  created_at timestamptz not null default clock_timestamp(),
  created_by text not null
);
create index event_markers_property_idx on event_markers(property_id, from_date);
