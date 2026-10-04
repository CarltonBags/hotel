-- Mail waiting to be sent (ticket 82 scheduled reports first; the mail provider sends from here with ticket 39).
create table control.mail_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references control.tenants(id) on delete cascade,
  -- mail of a user goes to that user's own address only
  to_user_id text not null references control."user"(id) on delete cascade,
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
create index mail_outbox_unsent_idx on control.mail_outbox(created_at) where sent_at is null;
