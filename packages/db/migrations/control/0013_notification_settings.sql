-- Staff Notifications per user (ticket 39): in the app always, by email if wanted, by SMS for the urgent kinds (Property Managers only).
alter table control.user_preferences add column notify_email boolean not null default true;
alter table control.user_preferences add column notify_sms boolean not null default false;
alter table control.user_preferences add column notify_phone text constraint user_preferences_notify_phone_check check (notify_phone ~ '^\+[1-9][0-9]{6,14}$');

-- A hotel's own sending domain belongs to one tenant: nobody else can send as it.
create table control.sender_domains (
  domain text primary key,
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  property_id uuid not null,
  created_at timestamptz not null default now()
);
