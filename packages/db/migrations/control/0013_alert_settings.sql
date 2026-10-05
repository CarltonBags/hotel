-- Staff alerts per user (ticket 39): in-app always, by email if wanted, by SMS for the urgent kinds (Property Manager and Owner only).
alter table control.user_preferences add column alert_email boolean not null default true;
alter table control.user_preferences add column alert_sms boolean not null default false;
alter table control.user_preferences add column alert_phone text constraint user_preferences_alert_phone_check check (alert_phone ~ '^\+[1-9][0-9]{6,14}$');
