# 50 — Cash desk: Cash Registers, Shifts, Cash Book, Paid-outs and Receipts

**What to build:** A property switches its cash desk on and defines Cash Registers. A user opens a Shift with a counted float and closes it with a blind count by denomination; the difference goes to the cash-difference account, above the tolerance (default 5.00) a reason is required and the Property Manager notified. Cash Book per register with running balance; movements: guest cash payments and refunds (Tender cash), Paid-outs with reason, receipt photo and expense account (Front Desk up to the limit, Approval above), bank deposits and change, transfers between registers, tips paid out. Every desk payment produces a Receipt separate from the Invoice, offered by email, as a code to scan, or printed; fiscal data added in tickets 51 and 52. Night Audit warns about open Shifts. Permissions per the cash rows of the matrix.

**Blocked by:** 27 Payments: Stripe onboarding, Card Holds, Tenders and refunds, 31 Approvals, role limits, Price Override and the audit log screen

**Status:** in review (pull request on branch ticket-50-cash-desk, stacked on ticket-24-calendar-availability)

- [x] Blind count: expected amount appears only after the count is entered
- [x] Difference above tolerance requires a reason and alerts the Property Manager
- [x] Paid-out above limit needs Approval
- [x] Cash Book balance equals float plus movements at any time

## Comments

**Built (2026-10-04).** Decided in "Cash handling and fiscal cash-register obligations" and "Permissions for cash, vouchers and outlet roles" (ADR 0013); fiscal signing comes with tickets 51 and 52.

**Settings** (Property Manager, Settings → Cash desk):
- The cash desk on or off per property.
- Count tolerance (default 5.00), Paid-out limit for the Front Desk (default 100.00), and the cash-difference account (required while on).
- Cash Registers can be added, taken out of use and used again.

**Shifts** (Property Manager, Front Desk):
- **Opening:** a Shift opens on a free register with the float counted by notes and coins (EUR, CHF). The first Shift books the float. Later, a count that differs from the Cash Book is booked as a difference; above the tolerance it needs a reason and the Property Managers are told. One open Shift per register and per user.
- **Blind close count:** the desk sees its Shift's movements without balances. The count is entered once; only then are expected and difference shown, and the count cannot change. Within the tolerance the Shift closes and books the difference. Above it, it waits for a reason; closing then books the difference and tells the Property Managers. No cash moves on a counted Shift.

**Cash Book:**
- Every movement of a register with the running balance: float, guest payment, refund, Paid-out, bank deposit, change money, transfer out/in, tip paid out, cash difference.
- Never changed or deleted, enforced by a trigger. Each movement carries its Business Date.
- The Property Manager and Accounting see every register; the desk sees its own open Shift.

**Cash at the desk:**
- Cash is a Tender. Payments and refunds go into the Cash Book of the user's open Shift. Without an open Shift there is no cash, and a refund cannot take more than the register holds.

**Paid-outs and other movements:**
- Paid-outs come from one's own Shift, with amount, reason, expense account and a photo of the paper receipt. Above the limit a Property Manager's Approval is needed, asked remotely or given on the same screen.
- Tips are paid out from one's own Shift.
- Bank deposits, change money and transfers between registers are for the Property Manager and Accounting.

**Receipts:**
- Every cash payment and refund and every card-terminal payment and refund gets a Receipt, separate from the Invoice.
- Numbered without gaps per property and never changed.
- Shown and printable from the reservation, or opened by the guest from its QR code without signing in. The Receipt shows the guest's initial and surname, and uses the property's time zone.

**Night Audit** warns about Shifts still open.

**Verified:**
- 393 tests green (domain 158, db 187), plus typecheck and the tenant SQL lint.
- The db tests cover the acceptance criteria, race-prone paths, immutability and the blind view.
- Browser walkthrough 11/11:
  - desk switched on, register added, Shift opened
  - Night Audit warning
  - cash payment with a Receipt readable from its code
  - Paid-out of 150 needing and getting Approval
  - the desk sees movements without a balance; the Property Manager's Cash Book shows 200 + 50 − 150 = 100
  - expected hidden before the count and shown after it (−20.00)
  - closing with a reason notifies the Property Manager

**Review fixes applied:**
- The blind count no longer leaks: no balances for the desk, register balances not sent to the desk, no balance in error messages.
- Every writer locks the register first, then the Shift, and re-checks after the lock (double count, payment into a counted Shift, deadlocks).
- No movement after the count.
- Receipt before Deposit Invoice reordered to match the card path.
- Receipt numbers taken only for a written Receipt.
- Immutability triggers on Receipts and on counted or closed Shifts; business-date stamp on movements.
- Paid-out photo required; difference account required.
- Opening differences above the tolerance follow the close rule.
- Receipts for card refunds.
- Receipt page: property time zone and locale, guest initial.
- UI: count result reset on a new Shift; register choice follows the free registers; distinct "Close with this reason".

**Open points:**
- **Fiscal signing** of Receipts (TSE in Germany, RKSV in Austria), outage handling and tax-audit exports: tickets 51 and 52. Until then the settings page says the desk is for testing and internal use.
- **Receipt by email** waits for email delivery (ticket 39).
- **Paid-out limit:** checked per Paid-out. Several Paid-outs under the limit need no Approval; confirm whether the limit should apply per Shift.
- **Receipts for other tenders:** bank transfer, on account and OTA payments get none, since no money changes hands at the desk.
- **Tips paid out** use the desk cash right (the matrix does not name them).

