# Night audit and business date

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 10

## Question

Define the Business Date per property and the Night Audit that rolls it. Decide: what the audit does in order (propose no-shows with per-reservation exclusion, check that every in-house reservation has its charges for the night (charges are posted at check-in, not by the audit), flag expiring card holds and folios with open balance, close the day's payments, lock the day for GoBD), who may run it and whether it can run automatically at a set time with a manual review step, what happens to check-ins and postings after midnight but before the audit, how a failed or partially completed audit is recovered, and what the audit report contains.

Already decided in "Permission matrix for fixed roles": Front Desk and Property Manager run the audit, Accounting views the result, and a closed Business Date cannot be reopened.

## Answer

Resolved 2026-09-28 by grilling.

**Business Date**
- Each property has its own Business Date, advanced only by its Night Audit. Properties of one tenant audit separately; there is no tenant-level audit.
- Everything that happens after midnight and before the audit belongs to the still-open Business Date. Every record stores both the Business Date and the real clock time.
- Invoices print the real calendar date as issue date. Daily totals and reports go by Business Date; revenue goes by Service Date.

**Start**
- Staff start the audit (Front Desk or Property Manager) inside a property-set window, default from 22:00.
- If the day is not closed by the deadline, default 06:00, Front Desk and Property Manager are alerted and a banner stays until the audit is run.
- The audit never closes by itself.

**Steps**
1. **Missing arrivals**: every Confirmed reservation with arrival on the Business Date and no check-in is decided individually: No-show, or excluded as **Late Arrival**. For each No-show the fee from its Cancellation Policy is shown; staff confirm it or waive it with a reason.
2. **Overdue departures**: every guest due out is checked out or extended.
3. **Warnings**, reviewed and carried forward, not blocking: folios with open balance, Card Holds about to expire, incomplete registrations, tomorrow's arrivals without a room, guests Arrived and Waiting for Room.
4. **Close**.

Only steps 1 and 2 block the close. Decisions in steps 1 to 3 are saved as a draft as staff go, so an interrupted audit resumes where it stopped.

**Close is all-or-nothing.** Either everything below happens, or nothing changes and staff see the reason:
- the day's payments, invoices, voids and totals become fixed;
- No-shows are marked, their remaining nights released to availability, confirmed fees posted;
- the Business Date advances;
- occupied rooms are set to Dirty and the Housekeeping Tasks for the new day are generated;
- availability changes are queued for the channel manager;
- the audit report is stored.
Charging confirmed no-show fees against the Card Guarantee runs after the close as follow-up work; failed charges appear as open balance with a notice.

**Late Arrival**: the reservation stays Confirmed and flagged, the room stays sold and held, and at check-in all nights including the missed one are posted. Housekeeping treats the room as an arrival. If the guest is still missing at the next audit, the reservation is proposed as No-show again.

**After the close**: records of a closed Business Date cannot change. A later correction, such as voiding last night's breakfast at checkout, is a new entry in the open Business Date that references the original. A closed Business Date cannot be reopened.

**Missed day**: the Business Date never jumps. Staff catch up by running the audit for each missed date in order; each produces its own report. While behind, a banner shows the lag.

**Report**: stored as PDF and as data, available under Reports to Property Manager and Accounting, not emailed. Kept 10 years. Contents: occupancy, arrivals, departures, No-shows, Late Arrivals; revenue by Service and Tax Code for the Service Date; payments by Tender; City Tax; open balances; expiring Card Holds; the day's voids, Price Overrides, refunds, Cancellation Invoices and Approvals; warnings carried forward.
