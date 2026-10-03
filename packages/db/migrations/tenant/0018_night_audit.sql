-- Night Audit and Business Date (ticket 32).

-- each property is on its own Business Date, advanced only by its Night Audit
alter table properties add column business_date date;
update properties set business_date = (now() at time zone time_zone)::date;
alter table properties alter column business_date set not null;
-- a new property starts on its own calendar date
create function properties_first_business_date() returns trigger language plpgsql as $$
begin
  if new.business_date is null then
    new.business_date := (now() at time zone new.time_zone)::date;
  end if;
  return new;
end $$;
create trigger properties_first_business_date before insert on properties for each row execute function properties_first_business_date();
-- the audit may start from this local time on the Business Date; it is overdue after the deadline the next morning
alter table properties add column night_audit_from time not null default '22:00';
alter table properties add column night_audit_deadline time not null default '06:00';
-- the Business Date an overdue alert was last sent for
alter table properties add column night_audit_alerted_for date;

-- a Late Arrival stays Confirmed, flagged, and is proposed again at the next audit
alter table reservations add column late_arrival boolean not null default false;
alter table reservation_changes drop constraint reservation_changes_action_check;
alter table reservation_changes add constraint reservation_changes_action_check
  check (action in ('edit', 'cancel', 'assign_room', 'move_room', 'unassign_room', 'fee_confirmed', 'fee_waived', 'check_in', 'cancel_check_in', 'check_out', 'price_override', 'no_show', 'late_arrival'));

-- every money record carries the Business Date it was made on, besides its real time
alter table charges add column business_date date;
alter table payments add column business_date date;
alter table invoices add column business_date date;
update charges c set business_date = (c.posted_at at time zone p.time_zone)::date from properties p where p.id = c.property_id;
update payments x set business_date = (x.posted_at at time zone p.time_zone)::date from properties p where p.id = x.property_id;
-- (an issued invoice never changes; its Business Date is set once, here)
alter table invoices disable trigger invoices_immutable;
update invoices i set business_date = (i.issued_at at time zone p.time_zone)::date from properties p where p.id = i.property_id;
alter table invoices enable trigger invoices_immutable;
alter table charges alter column business_date set not null;
alter table payments alter column business_date set not null;
alter table invoices alter column business_date set not null;

create function stamp_business_date() returns trigger language plpgsql as $$
begin
  if new.business_date is null then
    select business_date into new.business_date from properties where id = new.property_id;
  end if;
  return new;
end $$;
create trigger charges_business_date before insert on charges for each row execute function stamp_business_date();
create trigger payments_business_date before insert on payments for each row execute function stamp_business_date();
create trigger invoices_business_date before insert on invoices for each row execute function stamp_business_date();

-- a Charge of a closed Business Date is never voided: a correction in the open one reverses it
alter table charges drop constraint charges_origin_check;
alter table charges add constraint charges_origin_check check (origin in ('stay', 'catalogue', 'free_text', 'fee', 'correction'));
alter table charges add column corrects uuid references charges(id);
alter table charges add constraint charges_corrects_check check ((origin = 'correction') = (corrects is not null));
create unique index charges_corrects_key on charges(corrects) where corrects is not null;

-- one audit per property and Business Date: a draft of decisions while it runs, the report once closed
create table night_audits (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  business_date date not null,
  constraint night_audits_key unique (property_id, business_date),
  status text not null default 'draft' constraint night_audits_status_check check (status in ('draft', 'closed')),
  -- missing arrivals: reservation id -> No-show (fee confirmed or waived with reason) or Late Arrival
  decisions jsonb not null default '{}',
  report jsonb,
  report_pdf bytea,
  started_at timestamptz not null default clock_timestamp(),
  started_by text not null,
  closed_at timestamptz,
  closed_by text,
  constraint night_audits_closed_check check ((status = 'closed') = (closed_at is not null and closed_by is not null and report is not null))
);

-- a closed Business Date cannot be reopened: its audit only gets its PDF, once
create function night_audits_closed() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'closed' then raise exception 'A closed Business Date cannot be reopened'; end if;
    return old;
  end if;
  if old.status = 'closed' and (new.status <> 'closed' or new.decisions is distinct from old.decisions or new.report is distinct from old.report
     or new.business_date is distinct from old.business_date or new.closed_at is distinct from old.closed_at or new.closed_by is distinct from old.closed_by
     or (old.report_pdf is not null and new.report_pdf is distinct from old.report_pdf)) then
    raise exception 'A closed Business Date cannot be reopened';
  end if;
  return new;
end $$;
create trigger night_audits_closed before update or delete on night_audits for each row execute function night_audits_closed();
