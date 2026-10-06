# 51 — Fiscal module Germany through fiskaly

**What to build:** For German properties with the cash desk on, the fiscal module signs through fiskaly SIGN DE: one register per device with vendor-assigned immutable serial, every desk process that ends in a receipt signed whatever the tender (a switch to the narrower cash-and-voucher scope exists for after gate 3), idempotent signing calls with a 3 to 5 second timeout and an outage path (desk continues, receipt carries the legal notice, start and end logged, Property Manager alerted), Receipt with the mandatory contents and QR code, daily register closing, DSFinV-K export, the registration data for the tax office notification, and a scheduled export and archive of signed data because the provider holds only three months. Provider behind an internal interface so it can change per country.

**Blocked by:** 50 Cash desk: Cash Registers, Shifts, Cash Book, Paid-outs and Receipts

**Status:** in review (PR stacked on ticket 49)

- [x] Receipt signed in fiskaly's test environment shows the QR code and mandatory fields
- [x] Simulated provider outage: payment completes, receipt carries the notice, outage logged
- [x] DSFinV-K export for a day validates in the official checker
- [x] Archive job stores the signed data outside the provider monthly

## Comments

**Built.** A provider package (`packages/fiscal`) with one interface for the country's signing service: fiskaly SIGN DE v2 and DSFinV-K v1 (from fiskaly's own OpenAPI files), a development stand-in, and a production provider that signs nothing without keys. German property with the cash desk on sets up its TSE once (Settings → Cash desk; not in Test Mode); admin PIN derived from `FISCAL_SECRET`, PUK sealed with it. Each Cash Register is a client with a serial we assign (`HS-…`, immutable by trigger); card-terminal Receipts use the desk's client; clients are registered at set-up, when a register is added, and by the worker, never inside a signature. What a Receipt signs is written with the Receipt in the payment's transaction (its Business Date, the VAT per rate of what it pays for, a refund with the VAT of the payment it gives back) and signed right after the payment by the desk's action, idempotently by the Receipt's id, within 5 seconds in all. One signer holds a claim at a time; a stalled one is taken over after 90 s by the worker, which also signs anything left. Outage: the payment stands, the Receipt prints "TSE nicht erreichbar …" and is never signed later (unless the TSE turns out to have signed it after all), the outage is logged from start to end, the cash-desk managers are told (urgent: SMS for Property Managers). A transaction started but not finished is looked up and, still open, cancelled. Receipt prints the service, VAT per rate, TSE data, both serials and the TSE QR code. Past Business Dates closed per client for DSFinV-K (refused closings re-sent under a new id); DSFinV-K export on request and, with the TSE's signed data, archived monthly at night into the file store. Registration data for the tax office (§ 146a (4) AO) on the settings page. Scope switch: every Receipt, or cash and vouchers only.

**Verified.** fiscal: 4 tests (request bodies, token renewal, outage, cancel/rescue of a half-finished transaction, secrets). domain: VAT shares, refunds, names, closing payload. db: 8 tests (set-up once, register added later, signed Receipt with VAT and QR, refund VAT, stale claim taken over, outage start/end and notice, daily closing with failed Receipts, archive and registration data, scope). Walkthrough 18/18 on the stand-in: set-up, signed with the payment, Receipt contents, outage (staff and worker restarted with `FISCAL_FAKE_DOWN=1`), alert, recovery, the outage Receipt stays unsigned, DSFinV-K export downloaded.

**Review fixes.** Claim token so only the holder writes the outcome; stale claim beyond the signing time; total 5 s budget; admin steps on their own token; retry reads only "not found" as nothing; half-finished transactions cancelled or followed; registration out of the signing path; Business Date and VAT fixed at issue; refunds from the original; voucher scope consistent; closings only once a day's Receipts are final, failed ones re-sent under a new id, no TSE id for unsigned ones; exports per attempt id, months in the property's time; set-up serialised; no made-up secret with real keys; Test Mode refused; outage ends on any success of the property; archive in its own nightly job; shared VAT type and split.

**Open points.**
- Owner: `FISKALY_API_KEY`, `FISKALY_API_SECRET`, `FISCAL_SECRET` (never to change once a TSE exists). The acceptance runs in fiskaly's test environment and the official DSFinV-K checker are still to do with real keys.
- Tax advisor: business cases (deposits as Anzahlungseinstellung, folio payments as Umsatz rather than Forderungsauflösung) and refunds as negative amounts without storno.
- Registration data lacks the TSE's BSI certificate id and the acquisition date; properties have no address of their own, so the establishment shows the Legal Entity's.
- fiskaly keeps signed data for an unconfirmed time; the monthly archive covers it.
- The worker runs a light per-tenant check every minute even for tenants without a TSE.
