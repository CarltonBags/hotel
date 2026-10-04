-- Downtime Reports, offline desk and Catch-up Entry (ticket 86).

-- what each list shows, its sort, and the optional reminder at shift start (local time)
alter table properties add column downtime_options jsonb not null default '{}';

-- each outage of a property: start, end, whose side
create table property_outages (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  started_at timestamptz not null,
  ended_at timestamptz,
  constraint property_outages_order_check check (ended_at is null or ended_at > started_at),
  cause text not null default 'unknown' constraint property_outages_cause_check check (cause in ('hotel', 'ours', 'unknown')),
  note text not null default '',
  logged_by text not null,
  logged_at timestamptz not null default now()
);
create index property_outages_property_idx on property_outages(property_id, started_at);

-- a Catch-up Entry keeps the time it really happened beside the time it was entered
alter table reservation_changes add column real_at timestamptz;
alter table payments add column real_at timestamptz;
