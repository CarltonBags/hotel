# 32 — Night Audit and Business Date

**What to build:** Each property has a Business Date advanced only by its Night Audit, started by Front Desk or Property Manager inside the property's window (default from 22:00); an overdue banner and alert from 06:00. Steps: missing arrivals decided one by one as No-show (fee from the Cancellation Policy confirmed or waived with reason) or Late Arrival; overdue departures checked out or extended; non-blocking warnings (open balances, expiring Card Holds, incomplete registrations, tomorrow's arrivals without room, guests waiting for room, open Shifts); close. Decisions are saved as a draft. Close is all-or-nothing: fixes the day's money, marks No-shows and releases their nights, advances the date, sets occupied rooms Dirty, queues availability changes, stores the report as PDF and data; fee charging against Card Guarantees runs afterwards. Missed days are caught up in order. Every record stores Business Date and real time; a closed date cannot be reopened.

**Blocked by:** 28 Invoices with gap-free numbering, ZUGFeRD PDF, Deposit Invoice and check-out, 31 Approvals, role limits, Price Override and the audit log screen

**Status:** ready-for-agent

- [ ] Close fails as a whole when an injected step fails, leaving the date open
- [ ] Late Arrival stays Confirmed, is proposed again next audit, and check-in posts the missed night
- [ ] Catch-up of two missed days produces two reports in order
- [ ] Report contains the listed sections and is kept under Reports for PM and Accounting
