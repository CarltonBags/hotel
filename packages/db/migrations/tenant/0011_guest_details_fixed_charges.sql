-- Guest details for registration and billing, and Fixed Charges (ticket 96).

alter table guests add column salutation text constraint guests_salutation_check check (salutation in ('mr', 'ms', 'mx'));
alter table guests add column place_of_birth text;
alter table guests add column address_line2 text not null default '';
alter table guests add column region text not null default '';

-- a Service the stay carries for a range of nights (parking, a dog), posted night by night like the stay
create table fixed_charges (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  service_id uuid not null references services(id),
  from_date date not null,
  to_date date not null,
  constraint fixed_charges_dates_check check (to_date > from_date),
  quantity numeric(10, 2) not null default 1 constraint fixed_charges_quantity_check check (quantity > 0),
  unit_price numeric(12, 2) not null constraint fixed_charges_price_check check (unit_price >= 0),
  created_at timestamptz not null default clock_timestamp(),
  created_by text not null
);
create index fixed_charges_reservation_idx on fixed_charges(reservation_id);
