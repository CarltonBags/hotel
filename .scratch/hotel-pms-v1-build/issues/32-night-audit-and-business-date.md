# 32 — Night Audit and Business Date

**What to build:** Each property has a Business Date advanced only by its Night Audit, started by Front Desk or Property Manager inside the property's window (default from 22:00); an overdue banner and alert from 06:00. Steps: missing arrivals decided one by one as No-show (fee from the Cancellation Policy confirmed or waived with reason) or Late Arrival; overdue departures checked out or extended; non-blocking warnings (open balances, expiring Card Holds, incomplete registrations, tomorrow's arrivals without room, guests waiting for room, open Shifts); close. Decisions are saved as a draft. Close is all-or-nothing: fixes the day's money, marks No-shows and releases their nights, advances the date, sets occupied rooms Dirty, queues availability changes, stores the report as PDF and data; fee charging against Card Guarantees runs afterwards. Missed days are caught up in order. Every record stores Business Date and real time; a closed date cannot be reopened.

**Blocked by:** 28 Invoices with gap-free numbering, ZUGFeRD PDF, Deposit Invoice and check-out, 31 Approvals, role limits, Price Override and the audit log screen

**Status:** in review (pull request on branch ticket-32-night-audit, stacked on ticket-31-approvals)

- [x] Close fails as a whole when an injected step fails, leaving the date open
- [x] Late Arrival stays Confirmed, is proposed again next audit, and check-in posts the missed night
- [x] Catch-up of two missed days produces two reports in order
- [x] Report contains the listed sections and is kept under Reports for PM and Accounting

## Comments

**Built (2026-10-04).**

**Business Date** (Hoteltag):
- Each property is on its own Business Date, advanced only by its Night Audit; a new property starts on its calendar date.
- These work on it: check-in, stay changes, new bookings, room choices, Price Override, lists, Today and the Calendar.
- Invoices keep the calendar date as issue date, and receivables age by the calendar.
- Every record carries the Business Date it was made on beside its real time: charges, charge events, payments, invoices, reservation changes, approvals. It is stamped under a share lock, so a record written while the audit closes waits and carries the new date.

**Night Audit** (Tagesabschluss; Front Desk, Property Manager):
- **Window.** Opens from the property's time (default 22:00), and is overdue after the deadline next morning (default 06:00). A property behind the calendar may always run it, one day at a time; the Business Date is never more than one day ahead of the calendar.
- **Step 1.** Each missing arrival (Confirmed, due by the Business Date, earlier Late Arrivals included) is decided as:
  - No-show, with the Cancellation Policy's No-show fee confirmed, or waived with a reason;
  - or Spätanreise.

  Decisions are saved as a draft, so the audit resumes.
- **Step 2.** Guests past departure block the close; the audit screen offers "Check out" (refused while a guest folio is open) and "One more night".
- **Step 3.** Warnings carried into the report: open balances, Card Holds expiring within 48 hours, incomplete registrations, tomorrow's arrivals without a room.
- **The close is one transaction**, or nothing happens:
  - No-shows are marked and their rooms released; confirmed fees are posted on the folio as open balance.
  - Late Arrivals are flagged (proposed again; check-in posts the missed night and clears the flag).
  - The report is stored as data and PDF.
  - The Business Date advances.
- A closed Business Date cannot be reopened; a trigger guards the closed audit.

**Corrections** (ADR 0015):
- A Charge posted on a closed day for a closed night is never voided; a Correction of the opposite amount on the open day offsets it. A database trigger refuses the void.
- Invoiced Charges go by Cancellation Invoice; a corrected City Tax Charge files that night as borne by the hotel.

**Report** (Reports → Night Audit reports; Property Manager, Accounting; all kept, none deleted):
- Occupancy, arrivals, departures, No-shows, Late Arrivals.
- Revenue by Service and Tax Code for the Service Date, plus charges posted that day for earlier nights (late postings, Corrections).
- Payments by Tender, City Tax charged and absorbed, open balances, expiring Card Holds.
- The day's voids, Price Overrides, refunds, Cancellation Invoices and Approvals.
- Warnings carried forward.

**Overdue:** a banner for Front Desk and Property Manager while the audit is overdue or the date is behind; the worker alerts them once per overdue Business Date (every 15 minutes it checks).

**Verified:**
- 351 tests green, plus typecheck and the tenant SQL lint (it now allows a function's own `set search_path from current`).
- Browser walkthroughs:
  - Berlin, 11/11: decisions as draft, close, No-show with waived fee, Late Arrival proposed again, report PDF and sections, banner while behind.
  - Zürich: PDF stored with the close.
  - Berlin: Step 2 "One more night" for two guests past departure.
- PDF routes re-checked after the font fix.

**Review fixes applied:**
- Closed-day rule by posting day and night (ADR 0015) with a database guard.
- No Corrections of invoiced Charges; City Tax Corrections filed as absorbed.
- Report change sections selected by Business Date; late postings section; PDF stored with the close; every report listed.
- Stamping under a share lock; the closed audit guard also covers property and start.
- Alert marked before sending.
- Business Date on reservation changes, charge events and approvals.
- Step 2 actions on the audit screen.
- "Correction" in the glossary; No-show fee helper of its own.
- Trigger functions pin their tenant schema.
- The invoices package loads its fonts lazily: inside Next's server-action bundle the package could not be imported at all before (pages crashed).

**Open points:**
- Rooms turn Dirty at the close with ticket 33, Housekeeping Tasks with 34, availability to the channel manager with 37 (TODOs in the close).
- Charging confirmed No-show fees against a Card Guarantee waits for the guarantee itself; until then they stay as open balance.
- Warnings "Arrived and Waiting for Room" and open Shifts come with their tickets.
- A payment writer locks the reservation before the stamping trigger takes the property's share lock; during a close that touches the same reservation the database may abort one of them as a deadlock (rare; retry).
- The report PDF is in the closing user's language; the data can be re-rendered in the other.
- Report retention: kept indefinitely for now; the 10-year deletion comes with retention jobs (ticket 95).

