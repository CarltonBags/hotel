-- Fiscal module Germany through fiskaly (ticket 51).

-- the property's TSE (the provider's TSS): set up once, its admin PIN derived from the platform secret, its PUK sealed
create table fiscal_units (
  property_id uuid primary key references properties(id),
  provider text not null,
  tss_id uuid not null unique,
  tss_serial text not null,
  public_key text not null,
  signature_algorithm text not null,
  timestamp_format text not null,
  puk_sealed text not null,
  -- every desk process ending in a Receipt, or (a switch for later) cash and vouchers only
  scope text not null default 'all' constraint fiscal_units_scope_check check (scope in ('all', 'cash_and_vouchers')),
  in_use_since timestamptz not null default clock_timestamp(),
  created_by text not null
);

-- a client of the TSE: one per Cash Register, and one for the desk's Receipts without a register (card terminal); its serial never changes
create table fiscal_clients (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  register_id uuid unique references cash_registers(id),
  serial text not null unique constraint fiscal_clients_serial_check check (serial ~ '^[A-Za-z0-9-]{1,70}$'),
  registered_at timestamptz,
  dsfinvk_registered_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create unique index fiscal_clients_desk_idx on fiscal_clients(property_id) where register_id is null;

create function fiscal_clients_fixed() returns trigger language plpgsql set search_path from current as $$
begin
  if tg_op = 'DELETE' or (new.id, new.property_id, new.register_id, new.serial) is distinct from (old.id, old.property_id, old.register_id, old.serial) then
    raise exception 'A fiscal client and its serial never change';
  end if;
  return new;
end $$;
create trigger fiscal_clients_fixed before update or delete on fiscal_clients for each row execute function fiscal_clients_fixed();

-- a Receipt's signature (or its outage): written with the Receipt (what it signs, on its Business Date), claimed by
-- one signer at a time, then signed or failed; never changed after, except that a TSE found to have signed it after
-- all is followed (failed -> signed)
create table fiscal_transactions (
  receipt_id uuid primary key references receipts(id),
  -- BON_ID of the DSFinV-K export: ascending, never the TSE's own id
  export_id bigint generated always as identity unique,
  property_id uuid not null references properties(id),
  client_id uuid not null references fiscal_clients(id),
  state text not null default 'open' constraint fiscal_transactions_state_check check (state in ('open', 'signing', 'signed', 'failed')),
  -- the signer holding it: only that signer writes the outcome
  claim uuid,
  claimed_at timestamptz,
  attempts integer not null default 0,
  business_date date not null,
  business_case text not null constraint fiscal_transactions_case_check check (business_case in ('Umsatz', 'Anzahlungseinstellung')),
  tender text not null,
  currency char(3) not null,
  amount numeric(12, 2) not null,
  -- per VAT rate: [{rate, amount}], rate null when not determinable
  amounts jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  number bigint,
  time_start timestamptz,
  time_end timestamptz,
  signature text,
  signature_counter bigint,
  algorithm text,
  public_key text,
  tss_serial text,
  client_serial text,
  timestamp_format text,
  qr_code_data text,
  error text,
  finished_at timestamptz,
  constraint fiscal_transactions_signed_check check (state <> 'signed' or (signature is not null and qr_code_data is not null and number is not null)),
  constraint fiscal_transactions_failed_check check (state <> 'failed' or error is not null),
  constraint fiscal_transactions_claim_check check ((state = 'signing') = (claim is not null))
);
create index fiscal_transactions_day_idx on fiscal_transactions(client_id, business_date);
create index fiscal_transactions_unsigned_idx on fiscal_transactions(created_at) where state in ('open', 'signing');

create function fiscal_transactions_fixed() returns trigger language plpgsql set search_path from current as $$
begin
  if tg_op = 'DELETE' then
    if clearing_test_records() then return old; end if;
    raise exception 'A fiscal transaction is never deleted';
  end if;
  if old.state = 'signed' or (old.state = 'failed' and new.state <> 'signed') then
    raise exception 'A signed or failed fiscal transaction never changes';
  end if;
  if (new.receipt_id, new.export_id, new.property_id, new.client_id, new.business_date, new.business_case, new.tender, new.currency, new.amount, new.amounts, new.created_at)
     is distinct from (old.receipt_id, old.export_id, old.property_id, old.client_id, old.business_date, old.business_case, old.tender, old.currency, old.amount, old.amounts, old.created_at) then
    raise exception 'A fiscal transaction keeps what it signs';
  end if;
  return new;
end $$;
create trigger fiscal_transactions_fixed before update or delete on fiscal_transactions for each row execute function fiscal_transactions_fixed();

-- a TSE outage of a client: from the first Receipt it could not sign to the next one it signed
create table fiscal_outages (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  client_id uuid not null references fiscal_clients(id),
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  error text not null
);
create unique index fiscal_outages_open_idx on fiscal_outages(client_id) where ended_at is null;

-- the DSFinV-K daily closing (Kassenabschluss) of a client for a Business Date
create table fiscal_closings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  client_id uuid not null references fiscal_clients(id),
  business_date date not null,
  -- Z_NR: ascending per client, never reset
  export_number integer not null,
  -- the provider's id of the current attempt: a closing the provider refused is sent anew under a new id
  attempt_id uuid not null default gen_random_uuid(),
  state text not null default 'pending' constraint fiscal_closings_state_check check (state in ('pending', 'completed', 'failed')),
  error text,
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  unique (client_id, business_date),
  unique (client_id, export_number)
);

-- signed data kept outside the provider (it keeps it only for a while), and DSFinV-K exports
create table fiscal_archives (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  kind text not null constraint fiscal_archives_kind_check check (kind in ('tss', 'dsfinvk')),
  period_from date not null,
  period_to date not null,
  state text not null default 'pending' constraint fiscal_archives_state_check check (state in ('pending', 'completed', 'failed')),
  -- the provider's id of the current attempt: a failed export is asked anew under a new id
  attempt_id uuid not null default gen_random_uuid(),
  file_key text,
  bytes integer,
  error text,
  requested_by text not null,
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  unique (property_id, kind, period_from, period_to)
);
