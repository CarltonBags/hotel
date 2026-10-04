-- Report builder (ticket 84): a user's saved reports, private or shared with the property.
create table saved_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  property_id uuid not null references properties(id),
  name text not null constraint saved_reports_name_check check (length(trim(name)) between 1 and 120),
  definition jsonb not null,
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index saved_reports_owner_idx on saved_reports(owner_id);
create index saved_reports_shared_idx on saved_reports(property_id) where shared;
