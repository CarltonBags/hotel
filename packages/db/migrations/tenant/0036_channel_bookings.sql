-- Channel bookings inbound (ticket 38): bookings from booking sites and the hotel's website tool, applied once per
-- revision; settings per channel; who collects the money; payments taken by the website tool.

-- how each channel's prices arrive and what we do for its bookings
create table channel_settings (
  property_id uuid not null references properties(id),
  -- the channel's name as the channel manager gives it (e.g. "Booking.com"), or the website tool's
  channel text not null,
  prices_include_vat boolean not null default true,
  prices_include_city_tax boolean not null default false,
  -- our own confirmation email to the guest
  send_confirmation boolean not null default true,
  -- the hotel's website booking tool takes the money itself: recorded as a Payment
  paid_via_tool boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (property_id, channel)
);

-- Google's free booking links through the channel manager, switched on per property
alter table channel_connections add column google boolean not null default false;

create table channel_bookings (
  external_id text primary key,
  property_id uuid not null references properties(id),
  booking_id uuid not null references bookings(id),
  channel text not null,
  channel_code text not null,
  last_revision_id text not null,
  last_revision_at timestamptz not null,
  status text not null constraint channel_bookings_status_check check (status in ('new', 'modified', 'cancelled'))
);
create index channel_bookings_booking_idx on channel_bookings(booking_id);

-- every revision received, once; what became of it
create table channel_booking_revisions (
  id text primary key,
  property_id uuid not null references properties(id),
  external_booking_id text not null,
  status text not null,
  channel text not null,
  received_at timestamptz not null,
  applied_at timestamptz not null default now(),
  outcome text not null constraint channel_booking_revisions_outcome_check check (outcome in ('applied', 'stale', 'refused', 'conflict')),
  message text not null default '',
  -- a problem staff looked at
  resolved_at timestamptz,
  resolved_by text
);
create index channel_booking_revisions_open_idx on channel_booking_revisions(property_id, applied_at desc) where outcome in ('refused', 'conflict') and resolved_at is null;

-- a channel room matched over revisions
alter table reservations add column channel_room_key text;

-- who collects the guest's money on a channel booking; a booking site's virtual card and when it can be charged
alter table bookings add column channel_collect text constraint bookings_channel_collect_check check (channel_collect in ('property', 'channel'));
alter table bookings add column virtual_card_from date;
alter table bookings add column virtual_card_amount numeric(12, 2);

alter table payments drop constraint payments_tender_check;
alter table payments add constraint payments_tender_check check (tender in ('card_terminal', 'card_online', 'bank_transfer', 'on_account', 'ota_virtual_card', 'ota_collect', 'cash', 'website_tool'));
