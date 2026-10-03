-- Invoices, number ranges and check-out (ticket 28).

-- the seller block of an invoice: tax number (Steuernummer) and contact
alter table legal_entities add column tax_number text not null default '';
alter table legal_entities add column invoice_email text not null default '';
alter table legal_entities add column invoice_phone text not null default '';

-- a public-sector buyer's routing id (Leitweg-ID), the XRechnung buyer reference
alter table companies add column buyer_reference text not null default '';

-- one gap-free number range per Legal Entity; deposit and cancellation invoices use their own only when set up
create table invoice_number_ranges (
  legal_entity_id uuid not null references legal_entities(id),
  kind text not null constraint invoice_number_ranges_kind_check check (kind in ('final', 'deposit', 'cancellation')),
  format text not null,
  -- the counter the next invoice gets; it only moves inside the issuing transaction, so a rolled-back issue leaves no gap
  next_value integer not null default 1 constraint invoice_number_ranges_next_check check (next_value >= 1),
  -- with a year in the format the counter starts again each year
  counter_year integer,
  primary key (legal_entity_id, kind)
);

-- an issued invoice: numbered at issue, every shown value frozen (master data historised), never changed
create table invoices (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id),
  property_id uuid not null references properties(id),
  reservation_id uuid not null references reservations(id),
  folio_id uuid not null references folios(id),
  kind text not null constraint invoices_kind_check check (kind in ('final', 'deposit')),
  number text not null,
  constraint invoices_number_key unique (legal_entity_id, number),
  issue_date date not null,
  due_date date,
  currency char(3) not null,
  gross numeric(12, 2) not null,
  due numeric(12, 2) not null,
  -- unpaid on an on-account Bill-to: a Receivable (ticket 29)
  receivable boolean not null default false,
  -- the document as rendered: seller, buyer, lines, totals, deposits
  document jsonb not null,
  -- the payment a deposit invoice is for
  payment_id uuid references payments(id),
  -- a deposit invoice netted on this final invoice
  netted_by uuid references invoices(id),
  issued_at timestamptz not null default clock_timestamp(),
  issued_by text not null,
  -- the files as first rendered, kept so the invoice is handed out identically for good (GoBD)
  pdf bytea,
  xml text
);
create index invoices_reservation_idx on invoices(reservation_id);
create index invoices_folio_idx on invoices(folio_id);

alter table charges add column invoice_id uuid references invoices(id);
alter table payments add column invoice_id uuid references invoices(id);
create index charges_uninvoiced_idx on charges(folio_id) where invoice_id is null and voided_at is null;

alter table reservations add column checked_out_at timestamptz;
alter table reservations add column checked_out_by text;

alter table reservation_changes drop constraint reservation_changes_action_check;
alter table reservation_changes add constraint reservation_changes_action_check
  check (action in ('edit', 'cancel', 'assign_room', 'move_room', 'unassign_room', 'fee_confirmed', 'fee_waived', 'check_in', 'cancel_check_in', 'check_out'));
