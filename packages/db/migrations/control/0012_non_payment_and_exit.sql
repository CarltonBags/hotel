-- Non-payment ladder, exit and deletion (ticket 89).
alter table control.subscription_invoices add column paid_at timestamptz;
alter table control.subscription_invoices add column paid_by text;

-- a reminder per overdue invoice and reminder day, sent once
create table control.subscription_reminders (
  invoice_id uuid not null references control.subscription_invoices(id) on delete cascade,
  day integer not null,
  primary key (invoice_id, day),
  sent_at timestamptz not null default now()
);

-- the end of a customer: cancelled by the Owner or terminated by us; the data goes after 90 days
alter table control.tenants add column ended_at timestamptz;
alter table control.tenants add column ended_reason text;
alter table control.tenants add column deletion_due date;
alter table control.tenants add constraint tenants_end_check check ((ended_at is null) = (deletion_due is null));

-- the record of a deletion, kept after the tenant is gone
create table control.tenant_deletions (
  id bigserial primary key,
  tenant_id uuid not null,
  slug text not null,
  name text not null,
  ended_at timestamptz,
  ended_reason text,
  deleted_at timestamptz not null default now(),
  deleted_by text not null
);
