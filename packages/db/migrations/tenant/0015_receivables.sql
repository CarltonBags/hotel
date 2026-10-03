-- Cancellation Invoices, Receivables and reminder letters (ticket 29).

alter table invoices drop constraint invoices_kind_check;
alter table invoices add constraint invoices_kind_check check (kind in ('final', 'deposit', 'cancellation'));
-- a Cancellation Invoice names the invoice it cancels; the cancelled invoice names its Cancellation Invoice
alter table invoices add column cancels uuid references invoices(id);
alter table invoices add column cancelled_by uuid references invoices(id);
alter table invoices add constraint invoices_cancels_key unique (cancels);
-- a Cancellation Invoice always names what it cancels, and only it does
alter table invoices add constraint invoices_cancels_check check ((kind = 'cancellation') = (cancels is not null));

-- money matched to a Receivable by hand: an incoming transfer, possibly over several invoices
create table receivable_matches (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  amount numeric(12, 2) not null constraint receivable_matches_amount_check check (amount > 0),
  received_on date not null,
  reference text not null,
  created_at timestamptz not null default clock_timestamp(),
  created_by text not null
);
create index receivable_matches_invoice_idx on receivable_matches(invoice_id);

-- reminder letters at levels 1 to 3, frozen like invoices
create table reminders (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  level integer not null constraint reminders_level_check check (level between 1 and 3),
  constraint reminders_invoice_level_key unique (invoice_id, level),
  document jsonb not null,
  pdf bytea,
  issued_at timestamptz not null default clock_timestamp(),
  issued_by text not null
);

-- an issued invoice never changes: only its links (cancellation, netting, receivable flag) and its files, once, may be set
create function invoices_immutable() returns trigger language plpgsql as $$
begin
  if new.number is distinct from old.number or new.document is distinct from old.document or new.gross is distinct from old.gross
     or new.due is distinct from old.due or new.issue_date is distinct from old.issue_date or new.due_date is distinct from old.due_date
     or new.kind is distinct from old.kind or new.currency is distinct from old.currency
     or new.folio_id is distinct from old.folio_id or new.reservation_id is distinct from old.reservation_id
     or new.property_id is distinct from old.property_id or new.legal_entity_id is distinct from old.legal_entity_id
     or new.payment_id is distinct from old.payment_id or new.issued_at is distinct from old.issued_at or new.issued_by is distinct from old.issued_by
     or new.cancels is distinct from old.cancels
     or (old.pdf is not null and new.pdf is distinct from old.pdf) or (old.xml is not null and new.xml is distinct from old.xml)
     or (old.cancelled_by is not null and new.cancelled_by is distinct from old.cancelled_by)
     -- a cancelled invoice is no longer owed
     or (new.cancelled_by is not null and new.receivable) then
    raise exception 'An issued invoice cannot be changed; correct it with a Cancellation Invoice';
  end if;
  return new;
end $$;
create trigger invoices_immutable before update on invoices for each row execute function invoices_immutable();
create function invoices_no_delete() returns trigger language plpgsql as $$
begin
  raise exception 'An issued invoice cannot be deleted';
end $$;
create trigger invoices_no_delete before delete on invoices for each row execute function invoices_no_delete();

-- a reminder letter is frozen too: only its PDF, once
create function reminders_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A reminder letter cannot be deleted';
  end if;
  if new.invoice_id is distinct from old.invoice_id or new.level is distinct from old.level or new.document is distinct from old.document
     or new.issued_at is distinct from old.issued_at or new.issued_by is distinct from old.issued_by
     or (old.pdf is not null and new.pdf is distinct from old.pdf) then
    raise exception 'A reminder letter cannot be changed';
  end if;
  return new;
end $$;
create trigger reminders_immutable before update or delete on reminders for each row execute function reminders_immutable();

-- a matched transfer is part of the money trail: never changed or removed
create function receivable_matches_frozen() returns trigger language plpgsql as $$
begin
  raise exception 'A matched transfer cannot be changed or removed';
end $$;
create trigger receivable_matches_frozen before update or delete on receivable_matches for each row execute function receivable_matches_frozen();
