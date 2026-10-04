-- Devices and PIN Sign-in (ticket 14): enrolled hardware lives in the control schema with users and sessions.

-- a phone, tablet or kiosk enrolled to one property: staff (PIN Sign-in) or guest (long-lived token, no staff login)
create table control.devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  property_id uuid not null,
  kind text not null constraint devices_kind_check check (kind in ('staff', 'guest')),
  name text not null,
  -- a staff member's own phone, enrolled for that one user
  owner_user_id text references control."user"(id) on delete cascade,
  -- the long-lived device token, stored hashed
  token_hash text not null unique,
  enrolled_at timestamptz not null default now(),
  enrolled_by text not null,
  revoked_at timestamptz,
  revoked_by text,
  last_seen_at timestamptz,
  last_user_id text references control."user"(id) on delete set null
);
create index devices_tenant_property_idx on control.devices(tenant_id, property_id);

-- who may sign in on a shared staff Device
create table control.device_users (
  device_id uuid not null references control.devices(id) on delete cascade,
  user_id text not null references control."user"(id) on delete cascade,
  primary key (device_id, user_id)
);

-- a one-time enrolment code behind the QR code, stored hashed, valid 15 minutes
create table control.device_enrolments (
  code_hash text primary key,
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  property_id uuid not null,
  kind text not null constraint device_enrolments_kind_check check (kind in ('staff', 'guest')),
  name text not null,
  owner_user_id text references control."user"(id) on delete cascade,
  user_ids text[] not null default '{}',
  created_by text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- a sign-in made by PIN on a Device: valid only from that Device, ended when it is revoked
create table control.device_sessions (
  session_id text primary key references control.session(id) on delete cascade,
  device_id uuid not null references control.devices(id) on delete cascade
);
create index device_sessions_device_idx on control.device_sessions(device_id);

-- a user's PIN, stored hashed; five wrong tries lock the user on every Device
create table control.user_pins (
  user_id text primary key references control."user"(id) on delete cascade,
  pin_hash text not null,
  failed_count integer not null default 0,
  locked_at timestamptz,
  -- a first PIN set by someone else: changed at first sign-in
  must_change boolean not null default true,
  updated_at timestamptz not null default now()
);

-- every PIN sign-in, wrong try, lock, reset and unlock, with device and time
create table control.pin_events (
  id bigserial primary key,
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  user_id text not null references control."user"(id) on delete cascade,
  device_id uuid references control.devices(id) on delete set null,
  kind text not null constraint pin_events_kind_check check (kind in ('success', 'wrong', 'lock', 'reset', 'changed')),
  by_user_id text,
  at timestamptz not null default now()
);
create index pin_events_user_idx on control.pin_events(user_id, at desc);

-- a user created for a shared Device without an email: signs in only by PIN
alter table control."user" add column pin_only boolean not null default false;
