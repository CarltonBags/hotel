-- Role assignments live in the control schema (ADR 0006). Property ids point into
-- the tenant's own schema, so there is no foreign key across schemas; the
-- tenant_id on every row keeps them scoped.
create type control.tenant_role as enum ('owner', 'tenant_admin');
create type control.property_role as enum (
  'property_manager', 'front_desk', 'housekeeper', 'housekeeping_supervisor', 'maintenance',
  'accounting', 'revenue', 'service', 'spa_staff', 'outlet_manager'
);

-- At most one tenant role per user.
create table control.tenant_roles (
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  user_id text not null references control."user"(id) on delete cascade,
  role control.tenant_role not null,
  granted_at timestamptz not null default now(),
  granted_by text references control."user"(id) on delete set null,
  primary key (user_id)
);
create index tenant_roles_tenant_idx on control.tenant_roles(tenant_id);

create table control.property_roles (
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  user_id text not null references control."user"(id) on delete cascade,
  property_id uuid not null,
  role control.property_role not null,
  granted_at timestamptz not null default now(),
  granted_by text references control."user"(id) on delete set null,
  primary key (user_id, property_id, role)
);
create index property_roles_tenant_property_idx on control.property_roles(tenant_id, property_id);

-- One pending invitation per user; the token is stored hashed.
create table control.invitations (
  user_id text primary key references control."user"(id) on delete cascade,
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  token_hash text not null unique,
  invited_by text references control."user"(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
