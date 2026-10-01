-- Undo in the Rates grid (ticket 18).
-- A change's rows point at the change that undid them (nullable, no rewrite).
alter table rate_changes add column undone_by uuid;
-- Wall-clock time of the write, not of the transaction start: writers wait on
-- the property lock, so transaction-start times can be out of commit order and
-- undo's "changed again since" check compares these times.
alter table rate_changes alter column at set default clock_timestamp();
