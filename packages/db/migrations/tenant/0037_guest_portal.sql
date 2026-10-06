-- Guest Portal (ticket 40): Portal Links, the one-time code, Pre-check-in, companions, Messaging Consent, hotel info.

-- the link's secret part: random, unguessable; a new one revokes the old link
alter table reservations add column portal_key text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
create unique index reservations_portal_key on reservations(portal_key);
alter table bookings add column portal_key text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
create unique index bookings_portal_key on bookings(portal_key);

-- Pre-check-in: when the guest finished it, and when they expect to arrive
alter table reservations add column arrival_time text constraint reservations_arrival_time_check check (arrival_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table reservations add column precheckin_at timestamptz;

-- the other guests of a stay, as the guest entered them
create table reservation_companions (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  first_name text not null default '',
  last_name text not null constraint reservation_companions_name_check check (length(trim(last_name)) > 0),
  date_of_birth date,
  nationality char(2),
  created_at timestamptz not null default now(),
  created_by text not null
);
create index reservation_companions_reservation_idx on reservation_companions(reservation_id);

-- the fallback to the link: confirmation number and last name, then a code by email
create table portal_codes (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  -- asked by the Booker (not a room's guest): the code opens the whole booking
  for_booking boolean not null default false
);
create index portal_codes_reservation_idx on portal_codes(reservation_id, created_at desc);

-- a guest's agreement to receive messages on a transport: with time, source and wording
create table messaging_consents (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references guests(id) on delete cascade,
  transport text not null constraint messaging_consents_transport_check check (transport in ('email', 'whatsapp')),
  granted boolean not null,
  at timestamptz not null default now(),
  source text not null,
  wording text not null
);
create index messaging_consents_guest_idx on messaging_consents(guest_id, transport, at desc);

-- what the portal tells guests (per language), and whether guests may upload a picture of their document
alter table properties add column portal_info jsonb not null default '{}';
alter table properties add column portal_document_images boolean not null default false;
-- the property's own landscape behind the portal's glass card
alter table properties add column portal_photo_file_id uuid references stored_files(id) on delete set null;

-- a guest's document picture (per-property opt-in), in tenant file storage, kept as long as the registration form
alter table stored_files drop constraint stored_files_kind_check;
alter table stored_files add constraint stored_files_kind_check check (kind in ('issue_photo', 'fix_photo', 'id_document', 'portal_photo'));
create table reservation_documents (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  guest_id uuid references guests(id),
  file_id uuid not null references stored_files(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index reservation_documents_reservation_idx on reservation_documents(reservation_id);

-- a one-time code goes into its mail only when it is sent, and is gone from the record after
alter table guest_messages add column secret_code text;
