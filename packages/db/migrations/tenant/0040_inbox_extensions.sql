-- Inbox extensions (ticket 43): replies by email, message to task, retention.

-- the random part of the Conversation's reply address (<tenant>.<token>@<inbound domain>)
alter table conversations add column reply_token text not null default replace(gen_random_uuid()::text, '-', '');
alter table conversations add constraint conversations_reply_token_key unique (reply_token);
-- kept past its retention while a dispute is open
alter table conversations add column disputed_at timestamptz;
alter table conversations add column disputed_by text;

-- how a guest's message came: written in the Guest Portal or replied by email
alter table conversation_messages add column via text not null default 'portal' constraint conversation_messages_via_check check (via in ('portal', 'email'));

-- Conversations and their files go this many months after the stay (12; a property may shorten it)
alter table property_messaging add column conversation_months integer not null default 12 constraint property_messaging_conversation_months_check check (conversation_months between 1 and 12);

-- a guest message's reply address: replies land in its Conversation
alter table guest_messages add column reply_to text;

-- every email that came in, as received (kept with its Conversation); automatic replies are kept but not counted
create table inbound_mails (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null constraint inbound_mails_provider_key unique,
  conversation_id uuid references conversations(id) on delete cascade,
  sender text not null,
  subject text not null default '',
  auto_reply boolean not null,
  raw jsonb not null,
  received_at timestamptz not null default now()
);
create index inbound_mails_conversation_idx on inbound_mails(conversation_id);

-- a guest message turned into work, linked back
alter table maintenance_issues add column conversation_message_id uuid references conversation_messages(id) on delete set null;
alter table housekeeping_tasks add column conversation_message_id uuid references conversation_messages(id) on delete set null;
