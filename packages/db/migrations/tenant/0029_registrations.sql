-- Meldeschein registration on the tablet (ticket 45).

-- one registration per reservation; a guest tablet serves one at a time
create table registrations (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references reservations(id) on delete cascade,
  property_id uuid not null references properties(id),
  country text not null constraint registrations_country_check check (country in ('DE', 'AT')),
  -- the guest tablet it is on (an enrolled guest Device), and the persons it runs through in turn
  device_id uuid,
  queue uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by text not null
);
create unique index registrations_device_key on registrations(device_id) where device_id is not null;

create table registration_persons (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  -- the profile it writes back to (the primary guest), or none for a companion entered here
  guest_id uuid references guests(id) on delete set null,
  role text not null constraint registration_persons_role_check check (role in ('primary', 'spouse', 'partner', 'child', 'other')),
  first_name text not null default '',
  last_name text not null default '',
  date_of_birth date,
  nationality text not null default '',
  address_line1 text not null default '',
  postal_code text not null default '',
  city text not null default '',
  country text not null default '',
  document_number text not null default '',
  -- as in the travel document
  gender text not null default '' constraint registration_persons_gender_check check (gender in ('', 'f', 'm', 'x')),
  language text not null default 'de',
  step text not null default 'waiting' constraint registration_persons_step_check check (step in ('waiting', 'welcome', 'details', 'companions', 'review', 'done')),
  guest_done_at timestamptz,
  -- how it was confirmed: signed on the tablet (Austria) or on paper at the desk (Germany; the card path is ticket 46)
  confirmation text constraint registration_persons_confirmation_check check (confirmation in ('tablet_signature', 'paper')),
  signature bytea,
  paper_signed_by text,
  paper_signed_at timestamptz,
  constraint registration_persons_signature_check check ((confirmation = 'tablet_signature') = (signature is not null)),
  constraint registration_persons_paper_check check ((confirmation = 'paper') = (paper_signed_at is not null and paper_signed_by is not null)),
  id_checked_by text,
  id_checked_at timestamptz,
  id_check_note text not null default '',
  completed_at timestamptz,
  pdf bytea,
  created_at timestamptz not null default now()
);
create index registration_persons_registration_idx on registration_persons(registration_id);
