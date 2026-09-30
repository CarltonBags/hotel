# 86 — Downtime Reports, offline desk and Catch-up Entry

**What to build:** One button prints the Downtime Reports set (arrivals, expected departures, in-house, Room Rack grouped by floor with vacant rooms, blank registration forms) with date, time and user in the footer, each list also alone, contents and sort configurable, optional shift-start reminder. The staff app keeps the latest lists on each enrolled front desk device and, when the connection drops, shows them read-only with their age under a permanent banner with changes disabled and explained; an emergency report with open Card Holds and emergency contacts is saved encrypted to those devices every 2 hours and after the audit, optionally emailed or printed. Kiosk and tablet show only "come to reception". Afterwards staff make Catch-up Entries (check-in, check-out, payment, room move) with the real time, marked as entered after an outage, in the Business Date that was open; outage start and end are logged per property. When the cause is ours the status page says so and Property Managers get email and SMS.

**Blocked by:** 25 Today dashboard, operational lists and cross-property search, 32 Night Audit and Business Date, 14 Devices and PIN Sign-in

**Status:** ready-for-agent

- [ ] Downtime set prints as one job with footers
- [ ] Cut the connection: lists remain readable with age, all mutations disabled
- [ ] Catch-up Entry stores real time and entry time and lands in the right Business Date
- [ ] Emergency report on the device decrypts only for a signed-in user and old copies are deleted
