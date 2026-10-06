-- Site Bridge (ticket 68, ADR 0014): our program on the hotel's lock PC, outbound only, hosting Lock Plugins (and the FIAS till plugin).

create table site_bridges (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  name text not null constraint site_bridges_name_check check (length(trim(name)) between 1 and 60),
  enrolled_at timestamptz not null default clock_timestamp(),
  enrolled_by text not null,
  revoked_at timestamptz,
  -- what it last reported: its version, its plugins with their capabilities and health
  last_seen_at timestamptz,
  version text,
  plugins jsonb not null default '[]',
  -- the plugin versions pushed to it ({"name": "version"})
  wanted jsonb not null default '{}',
  -- the Property Manager was told it went quiet (cleared by its next call)
  alerted_at timestamptz
);
create index site_bridges_property_idx on site_bridges(property_id) where revoked_at is null;

-- what the service asks of a Bridge; the Bridge fetches it on its next call and answers on the one after
create table bridge_commands (
  id uuid primary key default gen_random_uuid(),
  bridge_id uuid not null references site_bridges(id),
  kind text not null constraint bridge_commands_kind_check check (kind in ('lock', 'plugin_install')),
  payload jsonb not null,
  state text not null default 'queued' constraint bridge_commands_state_check check (state in ('queued', 'sent', 'done', 'failed')),
  result jsonb,
  error text,
  created_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  done_at timestamptz
);
create index bridge_commands_open_idx on bridge_commands(bridge_id, created_at) where state in ('queued', 'sent');

-- a lock system on the hotel's network, reached through the Bridge and one of its plugins
alter table property_locks drop constraint property_locks_system_check;
alter table property_locks add constraint property_locks_system_check check (system in ('none', 'simulated', 'nuki', 'bridge', 'other'));
alter table property_locks add column bridge_plugin text not null default '';

create or replace function queue_lock_sync(reservation uuid) returns void language plpgsql set search_path from current as $$
begin
  insert into lock_sync (reservation_id)
  select r.id from reservations r join property_locks l on l.property_id = r.property_id
  where r.id = reservation and l.system in ('simulated', 'nuki', 'bridge')
  on conflict (reservation_id) do update set next_at = clock_timestamp(), attempts = 0, error = null, lease = null;
  if found then perform pg_notify('hs_lock_sync', current_schema()); end if;
end $$;
