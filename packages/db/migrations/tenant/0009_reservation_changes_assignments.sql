-- Edit, move and cancel reservations (ticket 22).

-- forced past Availability by Front Desk or Property Manager, flagged on the dashboard
alter table reservations add column overbooked boolean not null default false;
alter table reservations add column cancelled_at timestamptz;
alter table reservations add column cancelled_by text;
-- the Cancellation Policy fee at cancellation, for staff to confirm or waive (the folio posts confirmed fees)
alter table reservations add column cancellation_fee numeric(12, 2);
alter table reservations add column cancellation_fee_status text constraint reservations_fee_status_check check (cancellation_fee_status in ('open', 'confirmed', 'waived'));
alter table reservations add constraint reservations_fee_pair_check check ((cancellation_fee is null) = (cancellation_fee_status is null));

-- one entry per change with the state before and after
create table reservation_changes (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  user_id text not null,
  at timestamptz not null default clock_timestamp(),
  action text not null constraint reservation_changes_action_check check (action in ('edit', 'cancel', 'assign_room', 'move_room', 'unassign_room', 'fee_confirmed', 'fee_waived')),
  before jsonb not null default '{}'::jsonb,
  after jsonb not null default '{}'::jsonb
);
create index reservation_changes_reservation_idx on reservation_changes(reservation_id, at desc);

-- Room Assignment: a reservation in a room for nights [from_date, to_date); a mid-stay move adds a segment
create table room_assignments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  room_id uuid not null references rooms(id),
  from_date date not null,
  to_date date not null,
  constraint room_assignments_dates_check check (to_date > from_date)
);
create index room_assignments_reservation_idx on room_assignments(reservation_id, from_date);
create index room_assignments_room_idx on room_assignments(room_id, from_date, to_date);
