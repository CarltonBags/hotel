# 29 — Cancellation Invoice, Receivables and reminder letters

**What to build:** An issued Invoice is immutable; Front Desk, Accounting or Property Manager correct it by a Cancellation Invoice referencing the original followed by a new Invoice, also for a recipient change. Accounting works the open-invoice list per Company with due date and ageing, matches incoming transfers by hand, and sends reminder letters at levels 1 to 3 from the overdue list. Accounting sees the Cancellation Invoice list in the money audit log.

**Blocked by:** 28 Invoices with gap-free numbering, ZUGFeRD PDF, Deposit Invoice and check-out

**Status:** ready-for-agent

- [ ] Editing an issued invoice is impossible in UI and API
- [ ] Cancellation Invoice carries the original number and reverses its totals
- [ ] Ageing buckets on the receivables list add up to the open total
- [ ] Reminder letter PDF per level with the Legal Entity's footer
