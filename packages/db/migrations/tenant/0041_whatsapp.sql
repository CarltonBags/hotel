-- WhatsApp Module (ticket 44): the property's own business account and number, templates, guests' messages.

-- one number per property, connected by Embedded Signup (the platform's system user works it)
create table whatsapp_accounts (
  property_id uuid primary key references properties(id),
  waba_id text not null,
  phone_number_id text not null constraint whatsapp_accounts_number_key unique,
  display_number text not null default '',
  connected_at timestamptz not null default now(),
  connected_by text not null
);

-- templates per property, message type and language; an edit goes back to review and the approved text is used meanwhile
create table whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  type text not null,
  language text not null constraint whatsapp_templates_language_check check (language in ('de', 'en')),
  -- the latest version at Meta: an edit is a new version (hs_<type>_v<n>), the approved one goes out until it is approved
  name text not null,
  version integer not null default 1,
  -- with our {placeholders}
  text text not null,
  status text not null default 'in_review' constraint whatsapp_templates_status_check check (status in ('in_review', 'approved', 'rejected')),
  reason text,
  provider_id text,
  -- the version that goes out (paused or disabled by Meta: none)
  approved_name text,
  approved_text text,
  approved_provider_id text,
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint whatsapp_templates_key unique (property_id, type, language)
);
create index whatsapp_templates_provider_idx on whatsapp_templates(provider_id);

-- billed by Meta (a delivered template message): counted once per message
create table whatsapp_billed (
  provider_id text primary key,
  property_id uuid not null references properties(id),
  at timestamptz not null default now()
);

-- the guest's number a Conversation talks to, and when the guest last wrote (the 24-hour window)
alter table conversations add column whatsapp_phone text;
alter table conversations add column whatsapp_last_in timestamptz;

alter table conversation_messages drop constraint conversation_messages_via_check;
alter table conversation_messages add constraint conversation_messages_via_check check (via in ('portal', 'email', 'whatsapp'));
-- a message on WhatsApp: its id there and how far it got
alter table conversation_messages add column provider_id text;
alter table conversation_messages add column delivery text constraint conversation_messages_delivery_check check (delivery in ('sending', 'sent', 'delivered', 'read', 'failed'));
alter table conversation_messages add column delivery_error text;
create unique index conversation_messages_provider_key on conversation_messages(provider_id) where provider_id is not null;

-- an automatic message goes by WhatsApp (an approved template) or email, never both
alter table guest_messages add column transport text not null default 'email' constraint guest_messages_transport_check check (transport in ('email', 'whatsapp'));
alter table guest_messages add column to_phone text;
alter table guest_messages add column template_params jsonb;
create index guest_messages_provider_lookup_idx on guest_messages(provider_id) where provider_id is not null and transport = 'whatsapp';

-- WhatsApp messages not matched to a stay (unknown number, several stays, a shared number), until staff link them
create table whatsapp_unassigned (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  from_phone text not null,
  name text not null default '',
  body text not null default '',
  file_id uuid references stored_files(id) on delete set null,
  provider_id text not null constraint whatsapp_unassigned_provider_key unique,
  received_at timestamptz not null,
  linked_conversation_id uuid references conversations(id) on delete set null,
  linked_at timestamptz,
  linked_by text
);
create index whatsapp_unassigned_open_idx on whatsapp_unassigned(property_id, received_at) where linked_at is null;
