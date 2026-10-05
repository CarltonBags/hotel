-- Fiscal module Austria through fiskaly (ticket 52).

-- Austria prints Receipts on request: every desk has a printer (go-live checks it)
alter table properties add column receipt_printer text not null default '';

-- the Legal Entity's signature creation unit (one organisation at the provider each), registered with FinanzOnline
create table fiscal_at_units (
  legal_entity_id uuid primary key references legal_entities(id),
  provider text not null,
  scu_id uuid not null unique,
  certificate_serial text not null default '',
  api_key text not null,
  api_secret_sealed text not null,
  fon_participant_id text not null,
  fon_user_id text not null,
  fon_pin_sealed text not null,
  initialized_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default clock_timestamp()
);

-- an Austrian client is a register at the provider: its Kassenidentifikationsnummer and start receipt
alter table fiscal_clients add column provider_serial text;
alter table fiscal_clients add column initialization_receipt_id text;

-- Austria: refunds are cancellation receipts; the provider's receipt number and hints; signed while the SCU was out
alter table fiscal_transactions add column receipt_type text not null default 'normal' constraint fiscal_transactions_receipt_type_check check (receipt_type in ('normal', 'cancellation'));
alter table fiscal_transactions add column receipt_number text;
alter table fiscal_transactions add column hints jsonb not null default '[]';
alter table fiscal_transactions add column unit_failed boolean not null default false;

-- an outage over 48 hours is reported to FinanzOnline within a week: reminded, then marked reported
alter table fiscal_outages add column reminded_at timestamptz;
alter table fiscal_outages add column reported_at timestamptz;
alter table fiscal_outages add column reported_by text;

-- receipts the provider makes itself: start, monthly and yearly closing, fault clearance; the yearly one printed and checked
create table fiscal_system_receipts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  client_id uuid not null references fiscal_clients(id),
  provider_receipt_id text not null,
  receipt_type text not null constraint fiscal_system_receipts_type_check check (receipt_type in ('INITIALIZATION', 'MONTHLY_CLOSE', 'YEARLY_CLOSE', 'DECOMMISSION', 'SIGNATURE_CREATION_UNIT_FAULT_CLEARANCE')),
  receipt_number text not null,
  time_signature timestamptz not null,
  qr_code_data text not null,
  validation text constraint fiscal_system_receipts_validation_check check (validation in ('SUCCESS', 'ERROR')),
  printed_at timestamptz,
  printed_by text,
  unique (client_id, provider_receipt_id)
);

-- the data collection log (DEP7) of a register, kept like the other archives
alter table fiscal_archives drop constraint fiscal_archives_kind_check;
alter table fiscal_archives add constraint fiscal_archives_kind_check check (kind in ('tss', 'dsfinvk', 'dep'));
