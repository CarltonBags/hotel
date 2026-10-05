-- Guest Inbox and Conversations (ticket 42).

-- Desk Hours (property time; closing before opening runs past midnight, the same time both means around the clock),
-- the emergency number in the automatic reply, and when an unopened guest message goes to the Property Manager
alter table property_messaging add column desk_opens time not null default '07:00';
alter table property_messaging add column desk_closes time not null default '22:00';
alter table property_messaging add column emergency_phone text;
alter table property_messaging add column escalation_minutes integer not null default 15 constraint property_messaging_escalation_check check (escalation_minutes between 5 and 240);

-- one per Reservation, or per Booking for the Booker of several rooms
create table conversations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  reservation_id uuid unique references reservations(id) on delete cascade,
  booking_id uuid unique references bookings(id) on delete cascade,
  constraint conversations_owner_check check ((reservation_id is null) <> (booking_id is null)),
  -- the guest it is with (the stay's guest, or the Booker; none for a company Booker): earlier stays are theirs
  guest_id uuid references guests(id),
  last_message_at timestamptz,
  last_guest_message_at timestamptz,
  -- the first guest message nobody answered yet (waiting time)
  waiting_since timestamptz,
  -- the first guest message nobody opened yet (unread, escalation)
  unread_since timestamptz,
  -- the newest guest message a staff member opened
  seen_until timestamptz,
  claimed_by text,
  claimed_name text,
  claimed_at timestamptz,
  -- the Property Manager was told of the unread message since unread_since
  escalated_at timestamptz,
  -- the night (named by the date the desk opens) the automatic reply went
  desk_closed_night date,
  created_at timestamptz not null default now()
);
create index conversations_property_idx on conversations(property_id, last_message_at desc);
create index conversations_guest_idx on conversations(guest_id);
create index conversations_unread_idx on conversations(unread_since) where unread_since is not null;

-- a guest's or staff member's message, or an Internal Note; automatic messages are the guest_messages of the stay
create table conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  kind text not null constraint conversation_messages_kind_check check (kind in ('guest', 'staff', 'note')),
  user_id text,
  author_name text not null default '',
  body text not null default '',
  file_id uuid references stored_files(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  constraint conversation_messages_content_check check (body <> '' or file_id is not null)
);
create index conversation_messages_conversation_idx on conversation_messages(conversation_id, created_at);

-- quick replies per property and language, with placeholders
create table quick_replies (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  language text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint quick_replies_key unique (property_id, language, title)
);

-- images and PDFs in Conversations, both ways
alter table stored_files drop constraint stored_files_kind_check;
alter table stored_files add constraint stored_files_kind_check check (kind in ('issue_photo', 'fix_photo', 'id_document', 'portal_photo', 'conversation_file'));
