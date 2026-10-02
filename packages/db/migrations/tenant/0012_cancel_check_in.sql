-- Cancelling a check-in (follow-up to ticket 96): logged, and its stay Charges voided as such.

alter table reservation_changes drop constraint reservation_changes_action_check;
alter table reservation_changes add constraint reservation_changes_action_check
  check (action in ('edit', 'cancel', 'assign_room', 'move_room', 'unassign_room', 'fee_confirmed', 'fee_waived', 'check_in', 'cancel_check_in'));

alter table charges drop constraint charges_auto_void_check;
alter table charges add constraint charges_auto_void_check check (auto_void in ('early_departure', 'stay_changed', 'check_in_cancelled'));
