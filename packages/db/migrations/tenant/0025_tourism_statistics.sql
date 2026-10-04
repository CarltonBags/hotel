-- Official tourism statistics (ticket 85): statistical identity and deadline per property, its opening
-- calendar, guests left out with a reason, and the monthly reports frozen on submission.

alter table properties add column stats_identity text not null default '';
alter table properties add column stats_deadline_day integer not null default 5 constraint properties_stats_deadline_day_check check (stats_deadline_day between 1 and 28);

-- days the property is closed (both days included); every other day is an opening day
create table property_closures (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  from_date date not null,
  to_date date not null,
  constraint property_closures_dates_check check (to_date >= from_date),
  reason text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  created_by text not null
);
create index property_closures_property_idx on property_closures(property_id, from_date);

-- a stay the statistics leave out (for example refugees, stays over a year), with the reason
alter table reservations add column stats_excluded_reason text constraint reservations_stats_excluded_reason_check check (stats_excluded_reason is null or length(trim(stats_excluded_reason)) > 0);

-- a monthly report as submitted: never changed; a correction is a new version
create table tourism_reports (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  month char(7) not null constraint tourism_reports_month_check check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  version integer not null constraint tourism_reports_version_check check (version >= 1),
  data jsonb not null,
  submitted_at timestamptz not null default clock_timestamp(),
  submitted_by text not null,
  unique (property_id, month, version)
);
create function tourism_reports_frozen() returns trigger language plpgsql as $$
begin
  raise exception 'A submitted statistics report is never changed; submit a correction as a new version';
end $$;
create trigger tourism_reports_frozen before update or delete on tourism_reports for each row execute function tourism_reports_frozen();
