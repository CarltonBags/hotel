-- Rooming lists, Master Folio, deposit schedule and group check-in (ticket 59).

-- a group's reservation made before the name is known: its guest is a placeholder until the rooming list names it
alter table reservations add column name_pending boolean not null default false;

-- the organiser's link to fill in the rooming list (no sign-in)
alter table groups add column rooming_token text constraint groups_rooming_token_key unique;

-- the Master Folio: one per group, billed to the organiser; Charges on it keep the reservation they come from
alter table folios alter column reservation_id drop not null;
alter table folios add column group_id uuid references groups(id);
alter table folios add constraint folios_owner_check check ((reservation_id is null) <> (group_id is null));
create unique index folios_group_idx on folios(group_id) where group_id is not null;
-- a contract fee on a shrink or cancellation belongs to the group, not to a stay
alter table charges alter column reservation_id drop not null;
-- payments and invoices of the Master Folio belong to no single reservation
alter table payments alter column reservation_id drop not null;
alter table invoices alter column reservation_id drop not null;

-- the group's Routing Rules: Charges of these categories of its reservations go to the Master Folio (a reservation may deviate)
create table group_routing (
  group_id uuid not null references groups(id) on delete cascade,
  category text not null constraint group_routing_category_check check (category in ('accommodation', 'package', 'extras', 'city_tax')),
  primary key (group_id, category)
);

-- the deposit schedule: what the organiser pays by when; paid is read from the Master Folio's payments, in date order
create table group_deposits (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  due_date date not null,
  amount numeric(12, 2) not null constraint group_deposits_amount_check check (amount > 0),
  reminded_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index group_deposits_group_idx on group_deposits(group_id, due_date);

-- Germany (BMG §30(3)): for a travel group above ten persons the tour leader registers, with the number of members and their nationalities
create table group_registrations (
  id uuid primary key default gen_random_uuid(),
  holding_id uuid not null constraint group_registrations_holding_key unique references group_holdings(id) on delete cascade,
  leader_first_name text not null,
  leader_last_name text not null,
  leader_nationality char(2) not null,
  leader_birth_date date,
  leader_address text not null default '',
  -- the members besides the leader: [{ "nationality": "FR", "count": 12 }]
  members jsonb not null default '[]'::jsonb,
  signed_on_paper_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

-- a deposit reminder goes to the organiser
alter table mail_outbox add column group_id uuid references groups(id) on delete cascade;
alter table mail_outbox drop constraint mail_outbox_recipient_check;
alter table mail_outbox add constraint mail_outbox_recipient_check check (num_nonnulls(to_user_id, voucher_id, group_id) = 1);
