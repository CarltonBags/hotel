-- Spa self-booking in the Guest Portal (ticket 64): how long before an appointment a guest may still cancel it themselves.
alter table outlets add column spa_cancel_hours integer not null default 24 constraint outlets_spa_cancel_hours_check check (spa_cancel_hours between 0 and 168);
