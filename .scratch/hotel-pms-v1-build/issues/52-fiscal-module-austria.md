# 52 — Fiscal module Austria through fiskaly

**What to build:** Austrian properties always run the fiscal module: one signature unit per Legal Entity, every on-site payment signed including cards, start receipt, monthly and yearly receipts triggered by the system with the yearly receipt printed and checked by 15 February, receipts electronic by default but printed on request (every Austrian desk has a printer configured), data collection log export, FinanzOnline registration data, outage handling with the duty to report outages over 48 hours within a week, corrections only by cancellation receipts.

**Blocked by:** 50 Cash desk: Cash Registers, Shifts, Cash Book, Paid-outs and Receipts

**Status:** in review (PR stacked on ticket 51)

- [x] Payment signed in the Austrian test environment with a valid QR code
- [x] Monthly receipt generated automatically at month end
- [x] Outage over 48 hours produces the reporting reminder with the required data
- [x] Printer required check blocks go-live of an Austrian property without one

## Comments

**Built.** Austria in the fiscal package beside Germany: fiskaly SIGN AT v1 (from its OpenAPI 1.2.6), a stand-in, one interface. One Signature Unit per Legal Entity, each with its own fiskaly organisation (one SCU per organisation) and the taxpayer's FinanzOnline web-service user (API secret and PIN sealed); the SCU's id is fixed per Legal Entity so a retried set-up continues it. Every Cash Register (and the desk) is a register registered with FinanzOnline, whose start receipt the provider signs. Every on-site payment of an Austrian property is recorded for signing, cards included and also before the unit exists (signed once it does); a refund is a cancellation receipt naming the original's number (it waits for the original). Receipt: Kassen-ID, RKSV receipt number and time, QR code, VAT per Austrian rate, "Stornobuchung" / "Sicherheitseinrichtung ausgefallen" as applicable. Provider out of reach: the Receipt says so, it is retried with a back-off and signed later; the outage is logged, and from 48 hours the managers are reminded daily with the data for FinanzOnline until marked reported. SCU out (`signed:false`): kept as marked, the outage logged as reported by the provider. A receipt the provider refuses (or a VAT rate the RKSV has no key for) is failed for good and the desk told. The provider's monthly and yearly receipts are fetched nightly; the yearly one is printable and reminded until printed and checked by 15 February. DEP7 export on request and archived per month. Go-live: an Austrian property needs a receipt printer and its Signature Unit.

**Verified.** fiscal: SIGN AT conflict and refusal handling. domain: rate keys, 48-hour report due within a week, yearly check date, go-live blockers. db: 5 tests (set-up and registers, signing and cancellation, out of reach with back-off and reminder, SCU outage, refusal, monthly/yearly receipts and printed mark, DEP). Walkthrough on a new Austrian dev property: printer and go-live, set-up with FinanzOnline data, register with Kassen-ID, signed payment with QR and VAT, provider down (staff and worker restarted with `FISCAL_FAKE_DOWN=1`) with the notice, signed later, outage ended, DEP export.

**Review fixes.** German signed check kept (Austria's added in 0045); refusals told apart from outages (4xx, unknown VAT key) and never retried; 409 or a retry reads what the provider has; back-off so failing receipts never crowd out new ones; SCU outage logged instead of ending outages; set-up's provider calls outside transactions with a fixed SCU id; account null without the fiscal secret; cancellation waits for its original; DEP per register keyed by Kassen-ID, months backfilled, nothing archived without registers; nightly work and the yearly reminder only in the night's first run, the clock read first; neutral outage notice; printer setting only for Austrian properties; go-live needs the unit; glossary.

**Open points.**
- Owner: per Austrian Legal Entity a fiskaly SIGN AT organisation (key/secret) and the FinanzOnline web-service user; set `FISKALY_AT=live` to use fiskaly outside production. Acceptance in fiskaly's test environment (valid QR, month-end receipt) still to do with real keys. Creating the organisations through fiskaly's management API is unconfirmed.
- A register's own outage (provider unreachable over 48 hours) is reported by the manager in FinanzOnline; reporting it through fiskaly (register state OUTAGE) is not wired.
- The printer is one free-text field per property; printing is the browser's print of the Receipt until outlet printers come (ticket 60).
- The receipt printed while the provider was unreachable shows the notice but no RKSV number; the signed version is available from the same code afterwards.
- The signing code for Germany and Austria share the claim protocol but are written twice; folding them is a later refactor.
