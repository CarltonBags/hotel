# 89 — Non-payment ladder, exit export and tenant deletion

**What to build:** Overdue subscription invoices trigger the ladder: reminders to the Owner to day 30; banner for managers with settings and reports locked from day 30; no new reservations from channels from day 60 while existing stays can be handled and invoiced and export stays available; termination by us after day 90. On exit the Owner runs the self-service export in open formats (reservations, guests, companies, folios, payments as spreadsheets; every invoice and receipt as issued; fiscal exports; registration records inside retention), optionally a paid read-only archive; tenant data deleted 90 days after the end and backups within 30 more days. The Owner can delete the tenant.

**Blocked by:** 88 Modules and subscription billing

**Status:** ready-for-agent

- [ ] Ladder stages apply on the right days in a simulated timeline
- [ ] Export package complete and re-importable in spirit (documented columns)
- [ ] Deletion job removes the tenant schema and files after 90 days and logs it
