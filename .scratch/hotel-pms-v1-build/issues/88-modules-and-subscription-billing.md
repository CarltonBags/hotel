# 88 — Modules and subscription billing

**What to build:** Owner or Tenant Admin switch Modules on per property (channel connection, guest portal and self check-in, point of sale with spa, groups, WhatsApp) with the price shown, effective at once, billed from the next month, off at month end with data readable; Modules with setup start their checklist. Billing: per room per month base plus Modules, room count taken on the first including Out of Order, usage (SMS, WhatsApp) in arrears at cost plus handling, monthly e-invoice per Legal Entity of the customer, payment by SEPA direct debit or card, bank transfer on request, yearly prepayment discount; the Owner sees invoices and changes payment details. Prices are configuration, not code.

**Blocked by:** 87 Trial, Test Mode and Go-live

**Status:** in review (PR stacked on ticket 84)

- [x] Switching on the point of sale Module reveals its screens and starts its checklist
- [x] Monthly invoice for a two-property tenant lists rooms, Modules and usage correctly
- [x] Module off at month end keeps its data readable
- [x] Only the Owner reaches subscription screens

## Comments

**Built**
- Modules per property (`/settings/modules`, Owner or Tenant Admin, not support): channel connection, guest portal and self check-in, point of sale with spa, groups, WhatsApp.
  - The price is shown and confirmed; a Module is on at once and billed from the next month.
  - Off at the month's end: it runs until then, and its data stays readable after.
  - A Module needing setup carries its checklist (shown while on or ending).
  - Its menu entries show only where it is on (or readable).
- Price list (control schema, dated): set by support staff in the support console, from today on, the unit checked per price, who set it kept. Prices are configuration, not code.
- Monthly e-invoice per Legal Entity of the customer (ZUGFeRD PDF and XRechnung), numbered `HS-YYYY-NNNNN` without gaps, issued by a worker job on the 1st for live tenants:
  - Rooms counted on the 1st (kept, Out of Order included).
  - Modules billed for the month.
  - Last month's usage at cost plus handling, on the first invoice issued.
  - Yearly prepayment: twelve months of rooms once a year with the discount, none between; Modules and usage monthly.
  - VAT by place of supply: German VAT at home; reverse charge (EN16931 category AE) for an EU business with a VAT id; outside scope (O) beyond the EU.
- Subscription (`/settings/subscription`, Owner only, not support):
  - SEPA direct debit details: the mandate reference and the last digits; the account stays with the provider.
  - Yearly prepayment from next month; back to monthly only at the end of a prepaid year.
  - The invoices as PDF and XRechnung.
  - Bank transfer is set by support on request (chains).
- The menu now checks tenant actions one by one: the support access list shows to the Owner only, as its right says.

**Verified**
- Domain tests: Module states, billing months, the two-property invoice, the yearly term.
- DB tests: Module on and off with checklist and readable state; a two-property invoice (rooms, Modules, usage, totals), issued once, PDF and XML; prices validated; direct debit details; yearly term.
- All packages typecheck and pass.
- Walkthrough (4/4): point of sale on reveals its menu entry and starts its checklist; off at month end stays readable; invoice lists rooms per property and the Module, with a PDF; a Property Manager is refused the subscription page and the invoice file.

**Review fixes**
- Usage could be lost when the first Legal Entity had no property; it now goes on the first invoice issued.
- A second billing run now skips quietly instead of failing.
- Files are rendered after the number is taken, outside the counter's lock.
- The usage month uses the Berlin calendar.
- German VAT was charged to foreign customers; VAT now follows the place of supply.
- Saving SEPA details no longer switches a customer away from another payment method. Bank transfer is support's decision.
- The yearly discount now comes with an actual yearly prepayment.
- Prices are validated: no empty amounts, no back-dating, units by kind.
- Support sessions cannot download the Owner's invoices.

**Open points**
- Card payment of the subscription, and actually collecting SEPA debits, need the payment provider's billing integration. Until then the invoices state the method and are paid against them.
- Usage is billed only once an SMS or WhatsApp sender records it (tickets 39 and 44).
- Module screens are built in their own tickets (37, 40, 58, 60, 44); read-only after switching off is a rule those screens apply.
- Rooms are counted when the job runs on the 1st (04:30); a late run counts the rooms then.
- Line nets are derived from gross (the invoice model is gross-based), so a line can differ by a cent from the list price.
