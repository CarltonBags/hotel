# 50 — Cash desk: Cash Registers, Shifts, Cash Book, Paid-outs and Receipts

**What to build:** A property switches its cash desk on and defines Cash Registers. A user opens a Shift with a counted float and closes it with a blind count by denomination; the difference goes to the cash-difference account, above the tolerance (default 5.00) a reason is required and the Property Manager notified. Cash Book per register with running balance; movements: guest cash payments and refunds (Tender cash), Paid-outs with reason, receipt photo and expense account (Front Desk up to the limit, Approval above), bank deposits and change, transfers between registers, tips paid out. Every desk payment produces a Receipt separate from the Invoice, offered by email, as a code to scan, or printed; fiscal data added in tickets 51 and 52. Night Audit warns about open Shifts. Permissions per the cash rows of the matrix.

**Blocked by:** 27 Payments: Stripe onboarding, Card Holds, Tenders and refunds, 31 Approvals, role limits, Price Override and the audit log screen

**Status:** ready-for-agent

- [ ] Blind count: expected amount appears only after the count is entered
- [ ] Difference above tolerance requires a reason and alerts the Property Manager
- [ ] Paid-out above limit needs Approval
- [ ] Cash Book balance equals float plus movements at any time
