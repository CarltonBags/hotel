-- Room charges from external tills (ticket 65): our published room charge interface and the Lightspeed connection.

-- a till of the property that posts to rooms: our own interface ("api") or Lightspeed's room charge contract
create table till_connections (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  kind text not null constraint till_connections_kind_check check (kind in ('api', 'lightspeed')),
  name text not null constraint till_connections_name_check check (length(trim(name)) between 1 and 60),
  -- the key the till sends; kept as its hash only, shown once when made
  key_hash text not null constraint till_connections_key_hash_key unique,
  key_hint text not null,
  -- Lightspeed's businessExternalReference of the venue
  business_reference text not null default '',
  revenue_account text not null default '8400',
  tip_account text not null default '1590',
  -- the Tax Code per till rate where a rate fits more than one ({"7": "<tax code id>"})
  tax_codes jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  created_by text not null,
  constraint till_connections_property_id_name_key unique (property_id, name)
);

-- every posting a till sent, kept with its request: posted, or rejected and listed until staff reconcile it
create table till_postings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references till_connections(id),
  property_id uuid not null references properties(id),
  -- the till's own id of the bill (idempotency)
  external_id text not null,
  kind text not null constraint till_postings_kind_check check (kind in ('charge', 'reversal')),
  reservation_id uuid references reservations(id),
  receipt_number text not null default '',
  fiscal_id text not null default '',
  original_id uuid references till_postings(id),
  total numeric(12, 2) not null default 0,
  tip numeric(12, 2) not null default 0,
  status text not null constraint till_postings_status_check check (status in ('posted', 'rejected')),
  error text,
  payload jsonb not null,
  received_at timestamptz not null default clock_timestamp(),
  reconciled_at timestamptz,
  reconciled_by text,
  reconcile_note text,
  constraint till_postings_connection_id_external_id_key unique (connection_id, external_id),
  constraint till_postings_reconciled_check check (reconciled_at is null or status = 'rejected')
);
create index till_postings_open_idx on till_postings(property_id, received_at) where status = 'rejected' and reconciled_at is null;
create unique index till_postings_reversed_key on till_postings(original_id) where status = 'posted';

alter table charges add column till_posting_id uuid references till_postings(id);
