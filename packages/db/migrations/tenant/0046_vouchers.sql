-- Vouchers at the desk (ticket 53).

-- where a sold Voucher's value is owed: a liability of the Legal Entity, not revenue
alter table legal_entities add column voucher_liability_account text not null default '';

-- a value Voucher, sold at a property of a Legal Entity and redeemable at any of its properties
create table vouchers (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references legal_entities(id),
  property_id uuid not null references properties(id),
  code text not null unique constraint vouchers_code_check check (code ~ '^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$'),
  amount numeric(12, 2) not null constraint vouchers_amount_check check (amount > 0),
  currency char(3) not null,
  tender text not null constraint vouchers_tender_check check (tender in ('cash', 'card_terminal', 'bank_transfer')),
  reference text not null default '',
  -- the buyer, and who the code is sent to (the buyer gets a copy)
  buyer_name text not null default '',
  buyer_email text not null default '',
  recipient_name text not null default '',
  recipient_email text not null,
  message text not null default '',
  register_id uuid references cash_registers(id),
  sold_by text not null,
  sold_at timestamptz not null default clock_timestamp(),
  test boolean not null default in_test_mode()
);
create index vouchers_legal_entity_idx on vouchers(legal_entity_id, sold_at desc);

create function vouchers_fixed() returns trigger language plpgsql set search_path from current as $$
begin
  if tg_op = 'DELETE' and clearing_test_records() then return old; end if;
  raise exception 'A sold Voucher is never changed or deleted';
end $$;
create trigger vouchers_fixed before update or delete on vouchers for each row execute function vouchers_fixed();

-- redeeming is paying with the Voucher: a payment by the tender "voucher" names it; a refund of it gives the value back
alter table payments add column voucher_id uuid references vouchers(id);
alter table payments drop constraint payments_tender_check;
alter table payments add constraint payments_tender_check check (tender in ('card_terminal', 'card_online', 'bank_transfer', 'on_account', 'ota_virtual_card', 'ota_collect', 'cash', 'website_tool', 'voucher'));
alter table payments add constraint payments_voucher_check check ((tender = 'voucher') = (voucher_id is not null));
create index payments_voucher_idx on payments(voucher_id) where voucher_id is not null;

-- a Voucher sold for cash comes into the Cash Book, booked to the liability account
alter table cash_movements add column voucher_id uuid references vouchers(id);
alter table cash_movements drop constraint cash_movements_kind_check;
alter table cash_movements add constraint cash_movements_kind_check check (kind in ('float', 'payment', 'refund', 'paid_out', 'deposit', 'change_in', 'transfer_out', 'transfer_in', 'tip_out', 'difference', 'voucher_sale'));

-- the sale gets a Receipt too (signed in Germany and Austria): a Receipt is of a payment or of a Voucher sold
alter table receipts alter column payment_id drop not null;
alter table receipts add column voucher_id uuid unique references vouchers(id);
alter table receipts add constraint receipts_subject_check check ((payment_id is null) <> (voucher_id is null));

alter table fiscal_transactions drop constraint fiscal_transactions_case_check;
alter table fiscal_transactions add constraint fiscal_transactions_case_check check (business_case in ('Umsatz', 'Anzahlungseinstellung', 'MehrzweckgutscheinKauf'));

-- the Voucher's code by email, to someone who is not a user
alter table mail_outbox alter column to_user_id drop not null;
alter table mail_outbox add column voucher_id uuid references vouchers(id) on delete cascade;
alter table mail_outbox add constraint mail_outbox_recipient_check check ((to_user_id is null) <> (voucher_id is null));

create or replace function receipts_immutable() returns trigger language plpgsql set search_path from current as $$
begin
  if tg_op = 'DELETE' and clearing_test_records() then return old; end if;
  if tg_op = 'DELETE' or (new.number, new.payment_id, new.voucher_id, new.property_id, new.token, new.issued_at, new.issued_by, new.register_id) is distinct from (old.number, old.payment_id, old.voucher_id, old.property_id, old.token, old.issued_at, old.issued_by, old.register_id) then
    raise exception 'Receipts are never changed or deleted';
  end if;
  return new;
end $$;
