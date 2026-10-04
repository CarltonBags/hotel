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

-- every export of a report is logged with user and row count ("Personal data": receivables name their Bill-to)
create table report_exports (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  kind text not null,
  property_ids uuid[] not null,
  format text not null constraint report_exports_format_check check (format in ('csv', 'pdf', 'mail')),
  row_count integer not null,
  at timestamptz not null default now()
);
create index report_exports_at_idx on report_exports(at);

-- Mail waiting to be sent: scheduled reports first; the mail provider sends from here (ticket 39). Kept with the tenant's data.
create table mail_outbox (
  id uuid primary key default gen_random_uuid(),
  -- mail of a user goes to that user's own address only
  to_user_id text not null,
  to_email text not null,
  subject text not null,
  body text not null,
  attachment_name text,
  attachment_type text,
  attachment bytea,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint mail_outbox_attachment_check check ((attachment is null) = (attachment_name is null))
);
create index mail_outbox_unsent_idx on mail_outbox(created_at) where sent_at is null;
