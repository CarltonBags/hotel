-- Daily sign-in is Username + password at the tenant's address (ADR 0001 amendment 2026-10-01).
-- Unique within the tenant, case-insensitive. Existing users get one when their manager sets it.
alter table control."user" add column username text;
create unique index user_tenant_username_idx on control."user"(tenant_id, lower(username));
