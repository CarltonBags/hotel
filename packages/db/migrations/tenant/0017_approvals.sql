-- Approvals, Price Override and the audit log (ticket 31).

-- a Property Manager's consent to an action beyond another user's limit: requested and decided,
-- or granted on the same screen; used once, within 24 hours
create table approvals (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  kind text not null constraint approvals_kind_check check (kind in ('refund_over_limit', 'price_below_floor', 'complimentary')),
  -- what exactly is approved (the action's own key, e.g. payment and amount), and how it reads
  subject_key text not null,
  summary text not null,
  record_id uuid,
  requested_by text not null,
  requested_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  status text not null default 'pending' constraint approvals_status_check check (status in ('pending', 'approved', 'rejected', 'used')),
  decided_by text,
  decided_at timestamptz,
  note text not null default '',
  -- granted with the approver's credentials on the requester's screen
  in_place boolean not null default false,
  used_at timestamptz,
  constraint approvals_decided_check check ((status = 'pending') = (decided_by is null)),
  constraint approvals_used_check check ((status = 'used') = (used_at is not null))
);
create index approvals_property_idx on approvals(property_id, requested_at desc);
create index approvals_match_idx on approvals(kind, subject_key, requested_by) where status = 'approved';

-- who approved a reservation change beyond the user's limit
alter table reservation_changes add column approved_by text;
alter table reservation_changes drop constraint reservation_changes_action_check;
alter table reservation_changes add constraint reservation_changes_action_check
  check (action in ('edit', 'cancel', 'assign_room', 'move_room', 'unassign_room', 'fee_confirmed', 'fee_waived', 'check_in', 'cancel_check_in', 'check_out', 'price_override'));
