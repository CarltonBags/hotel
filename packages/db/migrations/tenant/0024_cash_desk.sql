-- The cash desk (ticket 50): Cash Registers, Shifts with blind counts, the Cash Book and Receipts.

alter table properties add column cash_desk boolean not null default false;
alter table properties add column cash_tolerance numeric(12, 2) not null default 5.00 constraint properties_cash_tolerance_check check (cash_tolerance >= 0);
alter table properties add column paid_out_limit numeric(12, 2) not null default 100.00 constraint properties_paid_out_limit_check check (paid_out_limit >= 0);
alter table properties add column cash_difference_account text not null default '';

-- cash is a Tender now
alter table payments drop constraint payments_tender_check;
alter table payments add constraint payments_tender_check check (tender in ('card_terminal', 'card_online', 'bank_transfer', 'on_account', 'ota_virtual_card', 'ota_collect', 'cash'));

-- a Paid-out above the property limit needs an Approval
alter table approvals drop constraint approvals_kind_check;
alter table approvals add constraint approvals_kind_check check (kind in ('refund_over_limit', 'price_below_floor', 'complimentary', 'paid_out_over_limit'));

create table cash_registers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  name text not null constraint cash_registers_name_check check (length(trim(name)) between 1 and 60),
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  unique (property_id, name)
);

-- one user's responsibility for a register, from counted float to counted close
create table cash_shifts (
  id uuid primary key default gen_random_uuid(),
  register_id uuid not null references cash_registers(id),
  property_id uuid not null references properties(id),
  user_id text not null,
  opened_at timestamptz not null default clock_timestamp(),
  opening_count jsonb not null,
  opening_float numeric(12, 2) not null,
  -- the close count, fixed once entered (the expected amount is shown only after it)
  counted_at timestamptz,
  close_count jsonb,
  counted numeric(12, 2),
  expected numeric(12, 2),
  difference numeric(12, 2),
  reason text,
  closed_at timestamptz,
  constraint cash_shifts_count_check check ((counted_at is null) = (counted is null) and (counted is null) = (expected is null)),
  constraint cash_shifts_closed_check check (closed_at is null or counted_at is not null)
);
create unique index cash_shifts_open_register_idx on cash_shifts(register_id) where closed_at is null;
create unique index cash_shifts_open_user_idx on cash_shifts(property_id, user_id) where closed_at is null;

-- the Cash Book: every movement of a register, never changed afterwards
create table cash_movements (
  id uuid primary key default gen_random_uuid(),
  register_id uuid not null references cash_registers(id),
  property_id uuid not null references properties(id),
  shift_id uuid references cash_shifts(id),
  kind text not null constraint cash_movements_kind_check check (kind in ('float', 'payment', 'refund', 'paid_out', 'deposit', 'change_in', 'transfer_out', 'transfer_in', 'tip_out', 'difference')),
  amount numeric(12, 2) not null,
  payment_id uuid references payments(id),
  counterpart_register_id uuid references cash_registers(id),
  reason text not null default '',
  account text not null default '',
  receipt_photo bytea,
  receipt_photo_type text,
  approved_by text,
  at timestamptz not null default clock_timestamp(),
  by_user text not null
);
create index cash_movements_register_idx on cash_movements(register_id, at);
create index cash_movements_shift_idx on cash_movements(shift_id);

create function cash_movements_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'Cash Book entries are never changed or deleted';
end $$;
create trigger cash_movements_immutable before update or delete on cash_movements for each row execute function cash_movements_immutable();

-- a Receipt for every desk payment (cash and card terminal), numbered per property; fiscal data with tickets 51 and 52
create table receipt_numbers (
  property_id uuid primary key references properties(id),
  last integer not null default 0
);
create table receipts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  number integer not null,
  payment_id uuid not null unique references payments(id),
  register_id uuid references cash_registers(id),
  -- opens the receipt from its printed or shown code without signing in
  token text not null unique,
  issued_at timestamptz not null default clock_timestamp(),
  issued_by text not null,
  emailed_to text,
  unique (property_id, number)
);

-- every movement carries the Business Date it was booked on, like payments and charges (ADR 0015)
alter table cash_movements add column business_date date;
create trigger cash_movements_business_date before insert on cash_movements for each row execute function stamp_business_date();
alter table cash_movements alter column business_date set not null;

-- a Receipt is never changed or deleted
create function receipts_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or (new.number, new.payment_id, new.property_id, new.token, new.issued_at, new.issued_by, new.register_id) is distinct from (old.number, old.payment_id, old.property_id, old.token, old.issued_at, old.issued_by, old.register_id) then
    raise exception 'Receipts are never changed or deleted';
  end if;
  return new;
end $$;
create trigger receipts_immutable before update or delete on receipts for each row execute function receipts_immutable();

-- a close count, once entered, stays as entered; a closed Shift does not change
create function cash_shifts_fixed() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.closed_at is not null
     or (old.counted_at is not null and (new.counted_at, new.close_count, new.counted, new.expected, new.difference) is distinct from (old.counted_at, old.close_count, old.counted, old.expected, old.difference))
     or (new.opened_at, new.opening_count, new.opening_float, new.register_id, new.user_id) is distinct from (old.opened_at, old.opening_count, old.opening_float, old.register_id, old.user_id) then
    raise exception 'A counted or closed Shift is not changed';
  end if;
  return new;
end $$;
create trigger cash_shifts_fixed before update or delete on cash_shifts for each row execute function cash_shifts_fixed();
