# Payments provider for EU hotels

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

Which payment provider fits a SaaS PMS for EU/DACH hotels? Compare Stripe, Adyen, Mollie and Unzer on: SEPA and card support, hotel-style pre-authorization and delayed capture (incremental auth for incidentals), card-present terminals at the front desk, PSD2/SCA handling for booking-engine payments, platform/marketplace model for paying out to each hotel (Stripe Connect etc.), tokenization for OTA virtual cards, refunds, and fees. Recommend one and record the constraints it puts on the folio and booking-engine flows.

## Answer

Recommendation: **Stripe** (Connect direct charges + Terminal), with Adyen as the enterprise fallback behind a provider-agnostic payment abstraction. Full findings: [../../../docs/research/payments-provider-eu.md](../../../docs/research/payments-provider-eu.md).

- Stripe documents the whole hotel card lifecycle online and card-present: 7-day default hold, 30-day extended auth for lodging MCC 7011, incremental auth (max 10 increments, no window extension), multicapture (up to 50 partial captures), and `capture_before` telling the folio when a hold expires. Terminal is GA in DE/AT/CH (girocard in DE) and runs under the hotel's connected account.
- Adyen is functionally equivalent (PreAuth + adjust authorisation, 30-day Visa/MC lodging validity, POS in DE/AT/CH) but Adyen for Platforms is sales-gated with a minimum invoice. Mollie caps auto-capture at 7 days, documents no incremental auth and only launched terminals in BE/DE/NL. Unzer supports Visa/MC only, documents "at least 7 days" holds, and publishes no terminal or platform API docs.
- Key constraints on the folio/booking engine: track per-auth expiry and re-authorize before it; hotels must carry MCC 7011; first auth needs 3DS with `setup_future_usage=off_session`, later increments/post-checkout charges are MITs; increments are capped, so batch incidentals; SEPA DD is never a hold instrument (no manual capture, 8-week no-reason chargeback, T+6); OTA virtual cards are keyed-in MOTO (SCA-exempt, CNP), a distinct tender type; refunds and disputes debit the hotel's connected balance under direct charges.
- Open risk: Stripe labels extended/incremental/multicapture as IC+ features; a blended-pricing platform must get them enabled by Stripe Support before launch. Mollie AT/CH terminal availability and Unzer platform APIs are UNVERIFIED.
