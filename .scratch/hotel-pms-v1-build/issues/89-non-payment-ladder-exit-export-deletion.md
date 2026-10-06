# 89 — Non-payment ladder, exit export and tenant deletion

**What to build:** Overdue subscription invoices trigger the ladder: reminders to the Owner to day 30; banner for managers with settings and reports locked from day 30; no new reservations from channels from day 60 while existing stays can be handled and invoiced and export stays available; termination by us after day 90. On exit the Owner runs the self-service export in open formats (reservations, guests, companies, folios, payments as spreadsheets; every invoice and receipt as issued; fiscal exports; registration records inside retention), optionally a paid read-only archive; tenant data deleted 90 days after the end and backups within 30 more days. The Owner can delete the tenant.

**Blocked by:** 88 Modules and subscription billing

**Status:** in review (PR stacked on ticket 88)

- [x] Ladder stages apply on the right days in a simulated timeline
- [x] Export package complete and re-importable in spirit (documented columns)
- [x] Deletion job removes the tenant schema and files after 90 days and logs it

## Comments

**Built**
- The ladder follows the oldest unpaid subscription invoice; each stage starts on its day:
  - from day 1: reminders to the Owner on days 1, 10, 20 and 30 (notification and queued email), sent once, released if sending fails;
  - from day 30: a banner for managers, with settings and reports locked through the one rights check (pages, actions, menus, the report builder, scheduled reports wait). Operations go on: desk, cash desk, users, devices, downtime lists; the subscription screens and the export stay open;
  - from day 60: no new online reservations (the rule `acceptsOnlineReservations`, noted on ticket 38 for the channel intake);
  - from day 90: termination by us (support console).
  - Support marks a subscription invoice paid by its number; the ladder clears.
- Exit (`/settings/exit`, Owner only, not support): the self-service export as one zip, open at every stage and logged. It contains:
  - reservations, guests, companies, folios, folio charges, payments, receipts and invoices as spreadsheet files, columns described in README.md;
  - every invoice as issued (ZUGFeRD PDF and XRechnung);
  - every Receipt as a PDF;
  - registration records within retention.
- Ending the contract (Owner, typed confirmation) or terminating (support): the data is deleted 90 days later by the daily job. The Owner may delete at once after the end. Every deletion is logged in `control.tenant_deletions`, and our own subscription invoices are kept.

**Verified**
- Domain tests: stages on a simulated timeline; locks; online reservations.
- DB tests:
  - stages by date;
  - reminders: the latest day reached, once;
  - termination refused before day 90; paying clears;
  - export contents and documented columns;
  - deletion 90 days after the end, schema gone, logged, invoices kept.
- All packages typecheck and pass.
- Walkthrough (3/3): day 35 banner with reports locked and arrivals open; export zip while restricted, logged; a trial ended by its Owner and deleted at once, schema gone, logged.

**Review fixes**
- Deleting a tenant destroyed our issued subscription invoices; they are now kept (no cascade).
- The lock now applies in the any-property checks, service settings, the report builder and scheduled reports.
- Locking users, devices, the cash desk and downtime lists would have blocked operations; they stay open.
- Stage days are consistent: day 30, 60 and 90 each start a stage.
- The worker uses the Berlin date, like the app.
- A reminder that fails is released for the next run.
- Test invoices are left out of the export; folios and Receipts are added.
- Phone numbers are no longer altered by the formula guard.
- The app no longer runs raw SQL; the Drizzle mirror is complete.

**Open points**
- The export is built in memory in the request; for very large tenants it belongs in a worker job writing to file storage (ticket 36).
- Fiscal exports come with tickets 51 and 52.
- The paid read-only archive is not built.
- Backups are deleted within 30 more days by the database provider's retention (operations).
- No new online reservations from day 60 is enforced once channels and the booking page exist (ticket 38 carries the rule).
