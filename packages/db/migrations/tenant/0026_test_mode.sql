-- Test Mode and Go-live (ticket 87).

-- a tenant before go-live is in Test Mode (the setting "test_mode" is "on"); existing tenants are live
create function in_test_mode() returns boolean language sql stable set search_path from current as $$
  select coalesce((select value = 'on' from tenant_settings where key = 'test_mode'), false)
$$;

-- records made while testing are marked; an import sets the mark off, so go-live keeps it
alter table guests add column test boolean not null default in_test_mode();
alter table companies add column test boolean not null default in_test_mode();
alter table bookings add column test boolean not null default in_test_mode();
alter table reservations add column test boolean not null default in_test_mode();
-- a test invoice carries a test number and no real one
alter table invoices add column test boolean not null default in_test_mode();

-- go-live clears the test records in one transaction that sets this flag; immutability holds everywhere else, and
-- always once the tenant is live
create function clearing_test_records() returns boolean language sql stable set search_path from current as $$
  select coalesce(current_setting('hoteloftware.clearing_test_records', true) = 'on', false) and in_test_mode()
$$;

create or replace function invoices_no_delete() returns trigger language plpgsql set search_path from current as $$
begin
  if clearing_test_records() then return old; end if;
  raise exception 'An issued invoice cannot be deleted';
end $$;

create or replace function reminders_immutable() returns trigger language plpgsql set search_path from current as $$
begin
  if tg_op = 'DELETE' then
    if clearing_test_records() then return old; end if;
    raise exception 'A reminder letter cannot be deleted';
  end if;
  if new.invoice_id is distinct from old.invoice_id or new.level is distinct from old.level or new.document is distinct from old.document
     or new.issued_at is distinct from old.issued_at or new.issued_by is distinct from old.issued_by
     or (old.pdf is not null and new.pdf is distinct from old.pdf) then
    raise exception 'A reminder letter cannot be changed';
  end if;
  return new;
end $$;

create or replace function receivable_matches_frozen() returns trigger language plpgsql set search_path from current as $$
begin
  if tg_op = 'DELETE' and clearing_test_records() then return old; end if;
  raise exception 'A matched transfer cannot be changed or removed';
end $$;

create or replace function cash_movements_immutable() returns trigger language plpgsql set search_path from current as $$
begin
  if tg_op = 'DELETE' and clearing_test_records() then return old; end if;
  raise exception 'Cash Book entries are never changed or deleted';
end $$;

create or replace function receipts_immutable() returns trigger language plpgsql set search_path from current as $$
begin
  if tg_op = 'DELETE' and clearing_test_records() then return old; end if;
  if tg_op = 'DELETE' or (new.number, new.payment_id, new.property_id, new.token, new.issued_at, new.issued_by, new.register_id) is distinct from (old.number, old.payment_id, old.property_id, old.token, old.issued_at, old.issued_by, old.register_id) then
    raise exception 'Receipts are never changed or deleted';
  end if;
  return new;
end $$;

create or replace function cash_shifts_fixed() returns trigger language plpgsql set search_path from current as $$
begin
  if tg_op = 'DELETE' and clearing_test_records() then return old; end if;
  if tg_op = 'DELETE' or old.closed_at is not null
     or (old.counted_at is not null and (new.counted_at, new.close_count, new.counted, new.expected, new.difference) is distinct from (old.counted_at, old.close_count, old.counted, old.expected, old.difference))
     or (new.opened_at, new.opening_count, new.opening_float, new.register_id, new.user_id) is distinct from (old.opened_at, old.opening_count, old.opening_float, old.register_id, old.user_id) then
    raise exception 'A counted or closed Shift is not changed';
  end if;
  return new;
end $$;

create or replace function tourism_reports_frozen() returns trigger language plpgsql set search_path from current as $$
begin
  if tg_op = 'DELETE' and clearing_test_records() then return old; end if;
  raise exception 'A submitted statistics report is never changed; submit a correction as a new version';
end $$;

create or replace function night_audits_closed() returns trigger language plpgsql set search_path from current as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'closed' and not clearing_test_records() then raise exception 'A closed Business Date cannot be reopened'; end if;
    return old;
  end if;
  if old.status = 'closed' and (new.status <> 'closed' or new.property_id is distinct from old.property_id or new.started_at is distinct from old.started_at
     or new.started_by is distinct from old.started_by or new.decisions is distinct from old.decisions or new.report is distinct from old.report
     or new.business_date is distinct from old.business_date or new.closed_at is distinct from old.closed_at or new.closed_by is distinct from old.closed_by
     or (old.report_pdf is not null and new.report_pdf is distinct from old.report_pdf)) then
    raise exception 'A closed Business Date cannot be reopened';
  end if;
  return new;
end $$;
