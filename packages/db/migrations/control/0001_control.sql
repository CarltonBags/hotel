-- Shared control schema (ADR 0006). This version: tenants, tenant schema versions
-- and the Better Auth tables. Role assignments, devices, subscription and external
-- id mappings arrive with their tickets. Business data never lives here.
create schema if not exists control;

create table control.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  schema_name text not null unique,
  created_at timestamptz not null default now()
);

-- Version of the tenant schema per tenant, written in the same transaction as the migration itself.
create table control.tenant_migrations (
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  version integer not null,
  name text not null,
  applied_at timestamptz not null default now(),
  primary key (tenant_id, version)
);

-- Better Auth tables (self-hosted). A user belongs to exactly one tenant (ADR 0001).
create table control."user" (
  id text primary key,
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index user_tenant_idx on control."user"(tenant_id);

create table control.session (
  id text primary key,
  user_id text not null references control."user"(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index session_user_idx on control.session(user_id);

create table control.account (
  id text primary key,
  user_id text not null references control."user"(id) on delete cascade,
  account_id text not null,
  provider_id text not null,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index account_user_idx on control.account(user_id);

create table control.verification (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index verification_identifier_idx on control.verification(identifier);
