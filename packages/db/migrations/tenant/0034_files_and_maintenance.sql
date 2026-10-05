-- Tenant file storage (ticket 36): every stored file, its place in the bucket under the tenant's prefix, and the day it goes.
create table stored_files (
  id uuid primary key default gen_random_uuid(),
  kind text not null constraint stored_files_kind_check check (kind in ('issue_photo', 'fix_photo')),
  -- tenant id / kind / file id; made by the app, never taken from a request
  key text not null unique,
  content_type text not null,
  size integer not null constraint stored_files_size_check check (size > 0),
  property_id uuid references properties(id),
  created_at timestamptz not null default now(),
  created_by text not null,
  -- retention: the file is deleted on this day (null while it is still needed)
  delete_after date
);
create index stored_files_retention_idx on stored_files(delete_after) where delete_after is not null;

-- Maintenance Issues (ticket 36): photos in file storage, the fix photo, and the Room Block the issue carries
alter table maintenance_issues add column photo_file_id uuid references stored_files(id) on delete set null;
alter table maintenance_issues add column fix_photo_file_id uuid references stored_files(id) on delete set null;
alter table maintenance_issues add column block_id uuid references room_blocks(id);
-- what the fixer chose about the block: ended (room Dirty) or kept
alter table maintenance_issues add column block_decision text constraint maintenance_issues_block_decision_check check (block_decision in ('ended', 'kept'));
