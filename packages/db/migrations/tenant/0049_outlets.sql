-- Outlets, menus, table service, printers and Outlet Sale (ticket 60).

-- a place at a property that sells (bar, restaurant, spa, other), with its own menu, printers, Cash Register and tables
create table outlets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  name text not null constraint outlets_name_check check (length(trim(name)) between 1 and 60),
  kind text not null constraint outlets_kind_check check (kind in ('bar', 'restaurant', 'spa', 'other')),
  cash_register_id uuid references cash_registers(id),
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  constraint outlets_property_id_name_key unique (property_id, name)
);

-- the Outlet Managers of an outlet: they edit its menu, prices, printers and tables
create table outlet_managers (
  outlet_id uuid not null references outlets(id) on delete cascade,
  user_id text not null,
  primary key (outlet_id, user_id)
);

-- kitchen and bar printers on the outlet's network (an ePOS address the outlet's device prints to)
create table outlet_printers (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id) on delete cascade,
  name text not null constraint outlet_printers_name_check check (length(trim(name)) between 1 and 60),
  kind text not null constraint outlet_printers_kind_check check (kind in ('kitchen', 'bar', 'other')),
  address text not null default '',
  active boolean not null default true,
  constraint outlet_printers_outlet_id_name_key unique (outlet_id, name)
);

-- the table plan
create table outlet_tables (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id) on delete cascade,
  name text not null constraint outlet_tables_name_check check (length(trim(name)) between 1 and 30),
  seats integer not null default 4 constraint outlet_tables_seats_check check (seats between 1 and 99),
  sort_order integer not null default 0,
  active boolean not null default true,
  constraint outlet_tables_outlet_id_name_key unique (outlet_id, name)
);

-- the menu: Services of the catalogue at the outlet's price, sent to a printer, with modifiers ([{ "name": "no ice", "price": 0 }])
create table outlet_menu_items (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id) on delete cascade,
  service_id uuid not null references services(id),
  name text not null constraint outlet_menu_items_name_check check (length(trim(name)) between 1 and 80),
  category text not null default '',
  price numeric(12, 2) not null constraint outlet_menu_items_price_check check (price >= 0),
  printer_id uuid references outlet_printers(id) on delete set null,
  modifiers jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sort_order integer not null default 0,
  constraint outlet_menu_items_outlet_id_name_key unique (outlet_id, name)
);

-- a bill per table or guest; an Outlet Sale is paid on the spot or invoiced on account to a Company
create table outlet_bills (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id),
  property_id uuid not null references properties(id),
  number integer not null,
  table_id uuid references outlet_tables(id),
  label text not null default '',
  customer_name text not null default '',
  company_id uuid references companies(id),
  status text not null default 'open' constraint outlet_bills_status_check check (status in ('open', 'paid', 'invoiced')),
  split_from uuid references outlet_bills(id),
  opened_by text not null,
  opened_at timestamptz not null default clock_timestamp(),
  closed_by text,
  closed_at timestamptz,
  constraint outlet_bills_outlet_id_number_key unique (outlet_id, number),
  constraint outlet_bills_closed_check check ((status = 'open') = (closed_at is null))
);
create index outlet_bills_open_idx on outlet_bills(outlet_id) where status = 'open';

-- an order round: what was sent to the printers together
create table outlet_rounds (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references outlet_bills(id),
  number integer not null,
  sent_by text not null,
  sent_at timestamptz not null default clock_timestamp(),
  constraint outlet_rounds_bill_id_number_key unique (bill_id, number)
);

-- an item on a bill, gross, with the modifiers chosen; sent once it has a round
create table outlet_bill_lines (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references outlet_bills(id),
  menu_item_id uuid references outlet_menu_items(id) on delete set null,
  service_id uuid not null references services(id),
  description text not null,
  quantity integer not null constraint outlet_bill_lines_quantity_check check (quantity between 1 and 999),
  unit_price numeric(12, 2) not null,
  amount numeric(12, 2) not null,
  modifiers jsonb not null default '[]'::jsonb,
  note text not null default '',
  printer_id uuid references outlet_printers(id) on delete set null,
  round_id uuid references outlet_rounds(id),
  created_by text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index outlet_bill_lines_bill_idx on outlet_bill_lines(bill_id);

-- what a printer is to print: a round's items for it; the outlet's device takes it and reports back
create table print_jobs (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id),
  printer_id uuid not null references outlet_printers(id),
  round_id uuid not null references outlet_rounds(id),
  ticket jsonb not null,
  status text not null default 'pending' constraint print_jobs_status_check check (status in ('pending', 'printing', 'printed', 'failed')),
  attempts integer not null default 0,
  error text,
  claimed_at timestamptz,
  printed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create index print_jobs_open_idx on print_jobs(outlet_id, created_at) where status in ('pending', 'printing', 'failed');

-- a closed bill's folio: its items as Charges (revenue by Service Date like any other), its payment, its Receipt or invoice
alter table folios add column outlet_bill_id uuid references outlet_bills(id);
alter table folios drop constraint folios_owner_check;
alter table folios add constraint folios_owner_check check (num_nonnulls(reservation_id, group_id, outlet_bill_id) = 1);
create unique index folios_outlet_bill_idx on folios(outlet_bill_id) where outlet_bill_id is not null;
-- an Outlet Sale paid on the spot has no Bill-to
alter table folios drop constraint folios_bill_to_check;
alter table folios add constraint folios_bill_to_check check (
  (bill_to_guest_id is null) <> (bill_to_company_id is null) or (outlet_bill_id is not null and bill_to_guest_id is null and bill_to_company_id is null)
);
alter table charges drop constraint charges_origin_check;
alter table charges add constraint charges_origin_check check (origin in ('stay', 'catalogue', 'free_text', 'fee', 'correction', 'outlet'));
