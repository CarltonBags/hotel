-- A major incident on our side alerts every customer's Property Managers once (ticket 86); the worker marks it first.
alter table control.status_incidents add column alerted_at timestamptz;
