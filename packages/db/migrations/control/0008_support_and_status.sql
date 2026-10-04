-- Support access, status page and help centre (ticket 93).

-- the platform's support staff: users of the platform's own tenant who may open any customer's tenant
create table control.support_staff (
  user_id text primary key references control."user"(id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by text
);

-- every support access to a customer's tenant: who, when, why; visible to the customer's Owner
create table control.support_accesses (
  id uuid primary key default gen_random_uuid(),
  staff_user_id text not null references control."user"(id),
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  reason text not null constraint support_accesses_reason_check check (length(trim(reason)) >= 10),
  token_hash text not null unique,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz
);
create index support_accesses_tenant_idx on control.support_accesses(tenant_id, started_at desc);

-- the status page: incidents with their updates, and planned maintenance
create table control.status_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null constraint status_incidents_title_check check (length(trim(title)) > 0),
  impact text not null constraint status_incidents_impact_check check (impact in ('minor', 'major')),
  started_at timestamptz not null,
  resolved_at timestamptz,
  constraint status_incidents_resolved_check check (resolved_at is null or resolved_at >= started_at),
  created_by text not null,
  created_at timestamptz not null default now()
);
create table control.status_incident_updates (
  id bigserial primary key,
  incident_id uuid not null references control.status_incidents(id) on delete cascade,
  state text not null constraint status_incident_updates_state_check check (state in ('investigating', 'identified', 'monitoring', 'resolved')),
  message text not null,
  at timestamptz not null default now(),
  by_user text not null
);
create index status_incident_updates_incident_idx on control.status_incident_updates(incident_id, at);
create table control.maintenance_windows (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  constraint maintenance_windows_dates_check check (ends_at > starts_at),
  announced_at timestamptz not null default now(),
  created_by text not null,
  cancelled_at timestamptz
);
