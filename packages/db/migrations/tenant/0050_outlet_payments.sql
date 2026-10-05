-- Outlet payments: Room Charge, readers and tap to pay, vouchers, tips, discounts, voids, outlet reports (ticket 61).

-- Room Charge: the amount per night a stay may run up at the outlets; a stay may be blocked from it ("cash only")
alter table properties add column spending_limit numeric(12, 2) not null default 150 constraint properties_spending_limit_check check (spending_limit >= 0);
alter table reservations add column room_charge_blocked boolean not null default false;

-- the discount Service and Spa Staff may give at the outlet without an Approval (percent)
alter table outlets add column discount_percent numeric(5, 2) not null default 0 constraint outlets_discount_percent_check check (discount_percent between 0 and 100);

-- a bill: its discount, the stay it was charged to, the guest's signature, a payment waiting at the reader
alter table outlet_bills add column discount_percent numeric(5, 2) not null default 0 constraint outlet_bills_discount_check check (discount_percent between 0 and 100);
alter table outlet_bills add column discount_approved_by text;
alter table outlet_bills add column reservation_id uuid references reservations(id);
alter table outlet_bills add column signature text;
alter table outlet_bills drop constraint outlet_bills_status_check;
alter table outlet_bills add constraint outlet_bills_status_check check (status in ('open', 'paying', 'paid', 'invoiced', 'charged'));
alter table outlet_bills drop constraint outlet_bills_closed_check;
alter table outlet_bills add constraint outlet_bills_closed_check check ((status in ('open', 'paying')) = (closed_at is null));

-- a sent item voided (with reason, an Approval for Service and Spa Staff); it stays on the bill, struck out
alter table outlet_bill_lines add column voided_at timestamptz;
alter table outlet_bill_lines add column voided_by text;
alter table outlet_bill_lines add column void_reason text;
alter table outlet_bill_lines add column void_approved_by text;
alter table outlet_bill_lines add constraint outlet_bill_lines_void_check check ((voided_at is null) = (void_reason is null));

-- a Room Charge on the stay's folio: one per Tax Code per bill, its items as detail
alter table charges add column outlet_bill_id uuid references outlet_bills(id);
alter table charges add column detail jsonb;
create index charges_outlet_bill_idx on charges(outlet_bill_id) where outlet_bill_id is not null;

-- a tip on top of the payment: not revenue, kept apart from the amount
alter table payments add column tip numeric(12, 2) not null default 0 constraint payments_tip_check check (tip >= 0);

-- a reader paired at an outlet, or a staff phone taking cards by tap to pay (not girocard)
alter table terminal_readers add column kind text not null default 'reader' constraint terminal_readers_kind_check check (kind in ('reader', 'phone'));

-- Approvals at the outlet (an Outlet Manager or the Property Manager gives them)
alter table approvals drop constraint approvals_kind_check;
alter table approvals add constraint approvals_kind_check check (kind in ('refund_over_limit', 'price_below_floor', 'complimentary', 'paid_out_over_limit', 'room_charge_over_limit', 'outlet_discount', 'outlet_void', 'outlet_refund'));
