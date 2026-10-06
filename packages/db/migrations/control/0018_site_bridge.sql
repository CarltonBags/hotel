-- Site Bridge (ticket 68): a Bridge's token names its tenant, so its outbound calls find their way in; plugins we publish for Bridges.
create table control.bridge_tokens (
  token_hash text primary key,
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  bridge_id uuid not null constraint bridge_tokens_bridge_id_key unique
);

-- every version of a Bridge plugin, kept: a Bridge fetches the one pushed to it and checks its hash
create table control.bridge_plugin_versions (
  name text not null constraint bridge_plugin_versions_name_check check (name ~ '^[a-z0-9-]{2,40}$'),
  version text not null constraint bridge_plugin_versions_version_check check (version ~ '^\d+\.\d+\.\d+$'),
  kind text not null constraint bridge_plugin_versions_kind_check check (kind in ('lock', 'till')),
  code text not null,
  sha256 text not null,
  published_at timestamptz not null default now(),
  primary key (name, version)
);
