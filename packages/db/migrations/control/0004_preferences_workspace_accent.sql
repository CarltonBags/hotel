-- Per-user shell settings (ticket 12): language, theme, Quick Access.
create table control.user_preferences (
  user_id text primary key references control."user"(id) on delete cascade,
  language text not null default 'en' check (language in ('de', 'en')),
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  quick_access jsonb,
  updated_at timestamptz not null default now()
);

-- Pinned Tabs are restored at next login per user and property scope ('all' or a property id).
create table control.user_workspace (
  user_id text not null references control."user"(id) on delete cascade,
  property_scope text not null,
  pinned_tabs jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, property_scope)
);

-- The tenant's accent colour; both themes derive from it. Ocean blue is the product default.
alter table control.tenants add column accent text not null default 'ocean';
