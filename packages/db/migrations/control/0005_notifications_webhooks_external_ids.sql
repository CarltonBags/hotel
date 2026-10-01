-- Ticket 13: live notifications, raw webhook intake and external id mappings (ADR 0006, 0007).

-- A notification for one user, or for every user of a tenant (user_id null). The worker
-- announces new rows with NOTIFY on channel hs_events; the SSE endpoint replays rows
-- after a client's Last-Event-ID so a reconnect catches up.
create table control.notifications (
  id bigserial primary key,
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  user_id text references control."user"(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  href text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_tenant_user_idx on control.notifications(tenant_id, user_id, id);

-- Every inbound webhook is stored raw and acknowledged before any processing.
-- (source, external_id) is unique: a replayed event is accepted but never processed twice.
create table control.webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  tenant_id uuid references control.tenants(id) on delete set null,
  headers jsonb not null,
  body jsonb,
  raw_body text not null,
  received_at timestamptz not null default now(),
  status text not null default 'received' check (status in ('received', 'processed', 'failed', 'ignored')),
  processed_at timestamptz,
  error text,
  unique (source, external_id)
);

-- Which tenant and property an external system's id belongs to (channel manager property,
-- payment account, ...). Webhooks arrive without a subdomain and resolve their tenant here.
create table control.external_ids (
  provider text not null,
  external_id text not null,
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  property_id uuid,
  created_at timestamptz not null default now(),
  primary key (provider, external_id)
);
