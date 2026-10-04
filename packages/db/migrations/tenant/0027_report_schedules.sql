-- Scheduled reports (ticket 82): a user's own fixed report, sent to their own address daily, weekly or monthly.
create table report_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  kind text not null constraint report_schedules_kind_check check (kind in ('occupancy', 'pickup', 'source_mix', 'cancellations', 'revenue_by_code', 'housekeeping', 'receivables', 'cash')),
  property_ids uuid[] not null constraint report_schedules_properties_check check (cardinality(property_ids) > 0),
  frequency text not null constraint report_schedules_frequency_check check (frequency in ('daily', 'weekly', 'monthly')),
  -- grain, comparisons, room type, report currency and stated rates
  options jsonb not null default '{}',
  language text not null default 'en' constraint report_schedules_language_check check (language in ('en', 'de')),
  created_at timestamptz not null default now(),
  -- the local day it was last sent: never twice a day
  last_sent_on date,
  -- stopped when the user lost the right to the report
  stopped_at timestamptz,
  stopped_reason text
);
create index report_schedules_user_idx on report_schedules(user_id);
