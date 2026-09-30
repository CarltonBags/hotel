# 51 — Fiscal module Germany through fiskaly

**What to build:** For German properties with the cash desk on, the fiscal module signs through fiskaly SIGN DE: one register per device with vendor-assigned immutable serial, every desk process that ends in a receipt signed whatever the tender (a switch to the narrower cash-and-voucher scope exists for after gate 3), idempotent signing calls with a 3 to 5 second timeout and an outage path (desk continues, receipt carries the legal notice, start and end logged, Property Manager alerted), Receipt with the mandatory contents and QR code, daily register closing, DSFinV-K export, the registration data for the tax office notification, and a scheduled export and archive of signed data because the provider holds only three months. Provider behind an internal interface so it can change per country.

**Blocked by:** 50 Cash desk: Cash Registers, Shifts, Cash Book, Paid-outs and Receipts

**Status:** ready-for-agent

- [ ] Receipt signed in fiskaly's test environment shows the QR code and mandatory fields
- [ ] Simulated provider outage: payment completes, receipt carries the notice, outage logged
- [ ] DSFinV-K export for a day validates in the official checker
- [ ] Archive job stores the signed data outside the provider monthly
