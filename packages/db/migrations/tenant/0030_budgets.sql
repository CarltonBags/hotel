-- Budget and Forecast (ticket 83): monthly figures per property and year; one Budget and one revised Forecast.
create table budgets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  year integer not null constraint budgets_year_check check (year between 2000 and 2100),
  version text not null constraint budgets_version_check check (version in ('budget', 'forecast')),
  constraint budgets_key unique (property_id, year, version),
  updated_at timestamptz not null default now(),
  updated_by text not null
);
create table budget_months (
  budget_id uuid not null references budgets(id) on delete cascade,
  month integer not null constraint budget_months_month_check check (month between 1 and 12),
  primary key (budget_id, month),
  occupancy numeric(5, 2) not null constraint budget_months_occupancy_check check (occupancy between 0 and 100),
  adr numeric(12, 2) not null constraint budget_months_adr_check check (adr >= 0),
  net_room_revenue numeric(14, 2) not null constraint budget_months_nrr_check check (net_room_revenue >= 0),
  total_revenue numeric(14, 2) not null constraint budget_months_total_check check (total_revenue >= net_room_revenue)
);
