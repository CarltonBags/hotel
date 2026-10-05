-- Automatic guest messages and staff alerts (ticket 39): settings per property, edited texts, each message with its delivery state, the SMS outbox.
create table property_messaging (
  property_id uuid primary key references properties(id),
  -- service messages go only between these local times
  sending_from time not null default '08:00',
  sending_to time not null default '20:00',
  constraint property_messaging_hours_check check (sending_from < sending_to),
  fallback_language text not null default 'de' constraint property_messaging_language_check check (fallback_language in ('de', 'en')),
  use_guest_language boolean not null default true,
  -- switchable types turned on or off: type -> boolean; absent means the shipped default
  switched jsonb not null default '{}',
  -- the hotel's own sending domain once verified at the provider; else the platform domain with the hotel's name
  sender_domain text,
  sender_local text not null default 'reservations' constraint property_messaging_local_check check (sender_local ~ '^[a-z0-9._-]{1,40}$'),
  sender_verified boolean not null default false,
  reply_to text,
  pre_arrival_days integer not null default 3 constraint property_messaging_pre_arrival_check check (pre_arrival_days between 1 and 30),
  -- events from before messaging started are not messaged (no flood of old bookings)
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table message_templates (
  property_id uuid not null references properties(id),
  type text not null,
  language text not null,
  subject text not null constraint message_templates_subject_check check (length(trim(subject)) > 0),
  blocks jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null,
  primary key (property_id, type, language)
);

create table guest_messages (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  reservation_id uuid not null references reservations(id),
  type text not null,
  -- what triggered it (a change, an invoice, a payment); empty for a once-per-reservation type
  trigger_key text not null default '',
  language text not null,
  to_email text,
  subject text not null,
  html text not null,
  body_text text not null,
  -- the document attached when sent
  invoice_id uuid references invoices(id),
  status text not null default 'queued' constraint guest_messages_status_check check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'suppressed')),
  reason text,
  send_after timestamptz not null,
  attempts integer not null default 0,
  provider_id text,
  created_at timestamptz not null default clock_timestamp(),
  -- null when automatic
  created_by text,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz
);
create unique index guest_messages_once_key on guest_messages(reservation_id, type, trigger_key);
create index guest_messages_due_idx on guest_messages(send_after) where status = 'queued';
create index guest_messages_provider_idx on guest_messages(provider_id) where provider_id is not null;

-- provider events per message, each once
create table message_events (
  id text primary key,
  message_id uuid references guest_messages(id),
  kind text not null,
  detail text not null default '',
  at timestamptz not null default now()
);

-- the address that hard-bounced or complained; a changed address sends again
alter table guests add column email_bounced text;
alter table guests add column email_complained text;

alter table mail_outbox add column attempts integer not null default 0;
alter table mail_outbox add column error text;
-- a rendered message (a test send of a guest text) keeps its layout
alter table mail_outbox add column html text;

create table sms_outbox (
  id uuid primary key default gen_random_uuid(),
  to_user_id text not null,
  to_phone text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  error text,
  provider_id text
);
create index sms_outbox_unsent_idx on sms_outbox(created_at) where sent_at is null;

-- properties of today start now; a property added later starts when it was created
insert into property_messaging (property_id) select id from properties;
