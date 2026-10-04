-- Trial and Go-live (ticket 87).
-- a trial tenant: demo data (deleted 30 days after the trial) or own data in Test Mode
alter table control.tenants add column trial_kind text constraint tenants_trial_kind_check check (trial_kind in ('demo', 'own'));
alter table control.tenants add column trial_ends_at timestamptz;
alter table control.tenants add constraint tenants_trial_check check ((trial_kind is null) = (trial_ends_at is null));
-- the go-live checklist, checked by the platform's support staff, then the moment of go-live; existing tenants are live
alter table control.tenants add column go_live_checked_by text references control."user"(id) on delete set null;
alter table control.tenants add column go_live_checked_at timestamptz;
-- the setup as it was checked: a change afterwards needs a new check
alter table control.tenants add column go_live_checked_setup jsonb;
alter table control.tenants add column live_at timestamptz;
update control.tenants set live_at = created_at;
