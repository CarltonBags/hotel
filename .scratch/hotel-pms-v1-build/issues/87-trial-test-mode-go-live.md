# 87 — Trial, Test Mode and Go-live

**What to build:** A hotel company signs up for a 30-day trial without payment details and chooses demo data (a demo property with rooms, rates, reservations, guests and a week of history, deleted 30 days after expiry) or its own data in Test Mode. In Test Mode all records made while testing are marked test, carry no real invoice numbers, reach no channel, charge no card and sign nothing fiscally. Going live: after contract a setup guide walks through the checklist (required, required-if-used, optional items as decided) checked by our staff; a preview shows the test records to be cleared; Go-live clears them, starts invoice numbering and sets the first Business Date.

**Blocked by:** 32 Night Audit and Business Date, 28 Invoices with gap-free numbering, ZUGFeRD PDF, Deposit Invoice and check-out

**Status:** ready-for-agent

- [ ] Trial tenant provisioned in under a minute with demo data
- [ ] Test Mode invoice carries a test mark and no real number; no email leaves to guests
- [ ] Go-live clearing removes test records and keeps setup and imported records
- [ ] Checklist blocks Go-live while a required item is missing
