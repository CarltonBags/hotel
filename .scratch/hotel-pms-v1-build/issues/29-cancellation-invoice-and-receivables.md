# 29 — Cancellation Invoice, Receivables and reminder letters

**What to build:** An issued Invoice is immutable; Front Desk, Accounting or Property Manager correct it by a Cancellation Invoice referencing the original followed by a new Invoice, also for a recipient change. Accounting works the open-invoice list per Company with due date and ageing, matches incoming transfers by hand, and sends reminder letters at levels 1 to 3 from the overdue list. Accounting sees the Cancellation Invoice list in the money audit log.

**Blocked by:** 28 Invoices with gap-free numbering, ZUGFeRD PDF, Deposit Invoice and check-out

**Status:** in review (pull request on branch ticket-29-receivables, stacked on ticket-28-invoices)

- [x] Editing an issued invoice is impossible in UI and API
- [x] Cancellation Invoice carries the original number and reverses its totals
- [x] Ageing buckets on the receivables list add up to the open total
- [x] Reminder letter PDF per level with the Legal Entity's footer

## Comments

**Built (2026-10-03).**

**Issued invoices are immutable.** A database trigger refuses any change to an issued invoice's number, document, amounts, dates, links or identity, and refuses deletes. Only links (cancellation, netting, receivable flag) and its files, once, may be set. The UI offers no edit. Reminder letters and matched transfers are frozen the same way.

**Cancellation Invoice** ("Cancel invoice" with a reason on the reservation; Front Desk, Accounting, Property Manager):
- Numbered from the cancellation range (or the invoice range when none is set).
- Mirrors the original's document and references its number and date. The PDF shows amounts negative; the XML is type 381 with a billing reference. Mustang validates both.
- The books store gross and due negative. The original is marked cancelled and no longer a Receivable.
- The original's Charges, payments and netted deposits are free again. Correct the folio (for a recipient change, move the Charges to the other folio) and issue the invoice again.
- A Deposit Invoice cancelled before check-in is issued anew at once for its payment. After check-in the payment counts as paid on the final invoice.
- Refused for a Cancellation Invoice, a deposit already netted (cancel the final invoice first), and an invoice with money matched to it.

**Receivables** (Cash & billing → Receivables; Accounting, Property Manager), per property:
- Open = due minus transfers matched by hand. Grouped by Bill-to, with due date and days overdue.
- Ageing buckets (not yet due, 1–30, 31–60, 61–90, over 90 days) add up to the open total.
- One transfer can be matched over several invoices, never above what is open.
- Reminder letters at levels 1, 2 and 3 for overdue invoices, frozen when issued. The PDF carries the Legal Entity's current details and footer and is kept at first render.
- The Cancellation Invoices of the property, with who issued them and why, are listed on the same page.

**Verified:**
- 310 tests green, plus typecheck and the tenant SQL lint.
- Browser walkthrough 14/14:
  - SQL update refused; cancel from the reservation; Mustang-valid cancellation PDF and XRechnung; re-issue under a new number.
  - An on-account stay checked out as a Receivable; ageing sums; reminders 1–3 with PDF; a transfer matched; the cancellation list.

**Review fixes applied:**
- Open amounts are read after the row lock, so concurrent matches cannot over-allocate and a match cannot slip past a cancellation.
- The trigger guards every column, and a cancelled invoice cannot become a Receivable again.
- A check ties kind cancellation to its reference.
- Reminders and matches are frozen.
- Grouping by Bill-to id, not name.
- Issuer shown on cancellations.
- The deposit is re-issued on cancel.
- The original's notes are kept.

**Open points:**
- The money audit log does not exist yet; the Cancellation Invoice list lives on the Receivables page until it does.
- A match cannot be undone, so an invoice with money matched cannot be cancelled. Undoing a match needs its own reversing entry (accounting ticket).
- Nothing enforces a gap between reminder levels; Accounting decides when the next one goes out. A letter covers one invoice.
- "Today" is the property's wall-clock date until the Night Audit's Business Date (ticket 32).
- A partly refunded deposit still has no correcting document of its own.

