-- The phone view's language, a setting per user (ticket 35); null: the user's app language.
alter table control.user_preferences add column floor_language text
  constraint user_preferences_floor_language_check check (floor_language in ('de', 'en', 'pl', 'ro', 'bg', 'hr', 'hu', 'tr', 'uk', 'ar'));

-- A phone's key to send changes made offline later under the user who made them, even after
-- someone else signed in on the Device; kept hashed, valid for a day.
create table control.device_change_keys (
  key_hash text primary key,
  device_id uuid not null references control.devices(id) on delete cascade,
  user_id text not null references control."user"(id) on delete cascade,
  expires_at timestamptz not null
);
create index device_change_keys_device_idx on control.device_change_keys(device_id);
