-- A deleted tenant's files (ticket 36): the bucket prefix is emptied by the daily job, which records when.
alter table control.tenant_deletions add column files_deleted_at timestamptz;
