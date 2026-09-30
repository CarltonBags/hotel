-- Tenant schema, version 1. Names are unqualified: the runner sets the search path.
create table tenant_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
