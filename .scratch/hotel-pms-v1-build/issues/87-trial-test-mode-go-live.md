# 87 — Trial, Test Mode and Go-live

**What to build:** A hotel company signs up for a 30-day trial without payment details and chooses demo data (a demo property with rooms, rates, reservations, guests and a week of history, deleted 30 days after expiry) or its own data in Test Mode. In Test Mode all records made while testing are marked test, carry no real invoice numbers, reach no channel, charge no card and sign nothing fiscally. Going live: after contract a setup guide walks through the checklist (required, required-if-used, optional items as decided) checked by our staff; a preview shows the test records to be cleared; Go-live clears them, starts invoice numbering and sets the first Business Date.

**Blocked by:** 32 Night Audit and Business Date, 28 Invoices with gap-free numbering, ZUGFeRD PDF, Deposit Invoice and check-out

**Status:** in review (PR stacked on ticket 93)

- [x] Trial tenant provisioned in under a minute with demo data
- [ ] Test Mode invoice carries a test mark and no real number; no email leaves to guests
- [x] Go-live clearing removes test records and keeps setup and imported records
- [x] Checklist blocks Go-live while a required item is missing

## Comments

**Built**
- Public signup `/signup` on the bare domain: company, address (slug), Owner, password, and the choice of demo data or own data. It provisions a tenant in Test Mode with `trial_ends_at` 30 days ahead (exact 24-hour days, safe across DST) and creates the Owner. Demo data is seeded through the normal operations: a demo property with 28 rooms, rates 500 days ahead, the Berlin City Tax, guests, a week of history (check-ins, check-outs and invoices, seven Night Audits) and three weeks of arrivals. About 2.5 s in dev. A failure removes the half-made tenant. Signup is capped platform-wide (`TRIALS_PER_HOUR`, default 20) and can be closed with `TRIAL_SIGNUP=off`.
- Test Mode is tenant-wide (decision 36: "the state of a tenant"; glossary aligned):
  - Guests, companies, bookings, reservations and invoices carry `test`, defaulting from the tenant setting.
  - Invoices get `TEST-00001…` numbers, a test note and a red mark on the PDF; the real number range is untouched.
  - Card payments and holds are refused when the provider runs on live keys. Pairing a reader still works.
  - Shell banner: Test Mode, trial days left, the demo note, and a link to the setup guide.
- Setup guide `/settings/go-live`:
  - Checklist with required, required-if-used and optional items, computed from the setup.
  - Platform support staff mark it checked from inside a Support Access (ticket 93). The check records the setup it covered; any later change needs a new check.
  - Preview of what will be cleared.
  - Go live: Owner only, with a confirmation; refused for demo tenants.
- Go-live runs in one transaction holding an exclusive lock on properties, so no write can slip in.
  - Cleared: all money, document, Cash Book, audit and housekeeping records, plus test guests, companies, bookings and reservations.
  - Kept: setup, and guests, companies and reservations with `test = false` (imports).
  - Then the Business Date of every property is set to its own today, and Test Mode is left.
  - The immutability triggers let these deletes through only while the clearing flag is set and the tenant is still in Test Mode.
- Worker: the daily maintenance job deletes demo tenants 30 days after their trial ends.
- Glossary entries Trial and Go-live Checklist; Go-live reworded to "tenant".

**Verified**
- Domain tests: checklist levels, the 500-day horizon per property, trial days, demo deletion, the mail rule. DB tests: demo trial in under a minute; TEST number with the range untouched; live provider refused; go-live blocked (missing item, unchecked, setup changed after the check); clearing keeps setup and imported records; real numbering continues from the range's start value; immutability holds once live; demo deletion keeps own-data trials. All packages typecheck and pass; the tenant SQL check is clean.
- Walkthrough (10/10):
  1. Demo signup takes 2.4 s and the banner shows 30 days left.
  2. The demo data holds 63 reservations, 7 audits and 15 invoices, all TEST.
  3. An empty own-data setup is blocked; after setup only the optional Devices remain open.
  4. The test invoice is TEST-00001.
  5. Support staff check the list through a Support Access.
  6. The preview counts 1 reservation, 1 invoice and 1 payment.
  7. Go-live clears them and keeps 3 rooms; the banner is gone.

**Review fixes**
- An exclusive lock taken before the checklist read: previously a concurrent write could leave a test record in a live tenant.
- The staff check now records the setup it covered.
- The price horizon counts per property from its own go-live day.
- "Users" is satisfied by the Owner alone, so a one-person guesthouse can go live.
- Signup cap counted in the database, not from a spoofable header; kind validated before use; cleanup errors logged.
- `deleteTenant` refuses live tenants; one failed demo deletion no longer stops the rest.
- Blocked go-live shows a plain message, not item ids; the unused `testMode` option and the rates re-export were removed.

**Open points**
- "No email leaves to guests" (the second acceptance item) stays unchecked: no mail is sent anywhere yet. `testModeMailRecipient` (domain) is the rule the email ticket (39) must apply: in Test Mode, mail only to the trial user.
- Checklist items for features that do not exist yet are absent:
  - registration mode for the country (required)
  - channel mapping, fiscal registration, foreign booking tool, Lock Bridge (required if used)
  - door locks, data import, point of sale (optional)
  - Each ticket adds its own item.
- City Tax Rule is required on every property, so a town without city tax cannot pass. Owner decision: keep it required, or add an explicit "no city tax" choice.
- Go-live clears every financial record, including any posted during testing on an imported reservation. A reservation imported as already checked in keeps its status without charges. The import ticket (90) must define what an import brings.
- Out-of-order room blocks, event markers, closed periods, rate history and the rooms' current cleanliness are treated as setup and kept.
- Receipts made in Test Mode are not marked as test; their numbering restarts at go-live.
- After a trial ends nothing is restricted yet (contract and billing: ticket 88). A demo user cannot carry on into an own-data tenant; a new signup is needed.
- `MIGRATIONS_DIR` must point at `packages/db/migrations` in production, where the staff app provisions trial schemas.
- The signup cap is platform-wide; a captcha or per-network limit belongs with production hosting.
- The walkthrough set up the own-data tenant through DB calls; the settings pages were walked through in their own tickets.
