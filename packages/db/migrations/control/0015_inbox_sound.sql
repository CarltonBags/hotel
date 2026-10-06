-- Guest Inbox (ticket 42): a sound with each new guest message, per user.
alter table control.user_preferences add column inbox_sound boolean not null default false;
