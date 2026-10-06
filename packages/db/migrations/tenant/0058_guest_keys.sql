-- Keys for guests (ticket 69): the handover lives with the lock settings; a Digital Key is something the guest's phone opens.
alter table properties drop column key_handover;
-- what the guest's phone opens (an invitation link or key token from the lock system), sealed
alter table room_keys add column guest_key_sealed text;
