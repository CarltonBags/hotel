# 90 — Data import: reservations, guests, companies and open money

**What to build:** Property Manager or Tenant Admin upload our spreadsheet templates in Test Mode: reservations with departure on or after go-live including in-house guests (room, price per night, guests, Source, notes, channel booking number, old card provider reference), guest profiles and Companies, open deposits, in-house balances, unpaid company invoices as opening Receivables, Vouchers in circulation. Every upload is a dry run first with rows ok, warning or blocking; duplicates are merged when certain or listed for decision; the old guest number is kept; import runs only without blocking errors; each Import Batch can be undone until Go-live; imported records are real and survive the clearing. In-house guests arrive Checked-in with an opening balance and only nights from Go-live are invoiced by us. Card Guarantees of imported reservations are "not secured" and listed; guests get a Portal Link to store a card again. Never imported: past invoices, registration records, users, card numbers.

**Blocked by:** 87 Trial, Test Mode and Go-live, 29 Cancellation Invoice, Receivables and reminder letters, 53 Vouchers at the desk

**Status:** ready-for-agent

- [ ] Dry run flags overlapping rooms, unknown room type and a deposit without reservation
- [ ] Undo of a batch removes exactly its records
- [ ] Imported in-house guest shows Checked-in with the opening balance on the folio
- [ ] Card columns are rejected by the template validator
