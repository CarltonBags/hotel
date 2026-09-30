# 88 — Modules and subscription billing

**What to build:** Owner or Tenant Admin switch Modules on per property (channel connection, guest portal and self check-in, point of sale with spa, groups, WhatsApp) with the price shown, effective at once, billed from the next month, off at month end with data readable; Modules with setup start their checklist. Billing: per room per month base plus Modules, room count taken on the first including Out of Order, usage (SMS, WhatsApp) in arrears at cost plus handling, monthly e-invoice per Legal Entity of the customer, payment by SEPA direct debit or card, bank transfer on request, yearly prepayment discount; the Owner sees invoices and changes payment details. Prices are configuration, not code.

**Blocked by:** 87 Trial, Test Mode and Go-live

**Status:** ready-for-agent

- [ ] Switching on the point of sale Module reveals its screens and starts its checklist
- [ ] Monthly invoice for a two-property tenant lists rooms, Modules and usage correctly
- [ ] Module off at month end keeps its data readable
- [ ] Only the Owner reaches subscription screens
