-- Devices and PIN Sign-in (ticket 14): an enrolled Device locks after this many idle minutes.
alter table properties add column device_idle_minutes integer not null default 2
  constraint properties_device_idle_minutes_check check (device_idle_minutes between 1 and 10);
