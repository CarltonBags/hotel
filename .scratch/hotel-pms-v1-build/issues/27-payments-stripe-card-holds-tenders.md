# 27 — Payments: Stripe onboarding, Card Holds, Tenders and refunds

**What to build:** A Property Manager onboards the Legal Entity to a Stripe connected account (direct charges) and pairs Stripe Terminal readers per workstation. Front Desk takes a Payment on a Folio by Tender: card terminal, bank transfer, on account, OTA virtual card keyed as MOTO, OTA collect; refunds are negative Payments linked to the original, with the Front Desk limit and Approval above it wired in ticket 31. A Card Hold is a pre-authorisation tracked with its expiry; the system warns before expiry and re-authorises; incremental holds are capped so incidentals are batched; holds are captured at checkout. Payment provider sits behind a provider-agnostic interface (research: Adyen as fallback).

**Blocked by:** 26 Check-in with folio posting, Charges and Routing Rules

**Status:** in review (pull request on branch ticket-27-payments)

- [x] Terminal payment posts a Payment and the folio balance updates live
- [x] A Card Hold shows its expiry and produces a warning job before it
- [x] Refund above the property limit is blocked until ticket 31 supplies Approval (stub returns denied)
- [x] Card numbers never touch our servers (tokens only), verified by code review and tests

## Comments

**Built (2026-10-03).**

**Provider.** A provider-independent payment interface with two implementations:
- **Stripe:** Connect direct charges; Standard accounts through Stripe-hosted onboarding with MCC 7011; Terminal readers and locations on the hotel's connected account.
- **Fake:** in-memory, for tests and development without keys. Production refuses to start without Stripe keys and webhook secret.

**Onboarding.** Settings → Payments and card readers. A Property Manager of one of the Legal Entity's properties onboards it (Owner and Tenant Admin everywhere). The same page pairs readers per property by registration code and sets the property's Front Desk refund limit (default 200).

**Payments by Tender on a folio.**
- Card terminal and OTA virtual card (keyed MOTO) go through the reader: the payment waits until the card is presented, then settles from the provider by desk polling or the webhook. Each request has its own idempotency key.
- Bank transfer is recorded with its reference. On account and OTA collect are recorded too. These count at once.
- Folio balances count payments, and the Today workspace shows the guest's balance after payments, live.

**Refunds** are negative payments linked to the original, back to the same card, under idempotency keys.
- Front Desk refunds up to the property limit per payment, counting earlier refunds of it. Above that an Approval is needed; the stub denies until ticket 31.
- A refund the provider did not answer stays pending and counted, and is sent again. One the hotel's balance cannot cover waits as "refund pending balance" and is retried hourly.

**Card Holds.**
- Placed on the reader; the card is saved to a provider customer for later use without the guest.
- Shown with expiry (the provider's capture deadline, else the card rules), raised within the provider's limits, and raised in one step to cover the balance. Beyond the limits a fresh hold goes on the saved card.
- Captured at checkout for what is due (never more than held; the rest released), as Tender card terminal, or card online for a renewed hold. Or released.
- The hourly worker check marks expired holds and renews holds of stays that outlast them: 48 h before expiry, or in the last half of a shorter hold. The old hold is released and the desk notified. Each hold is claimed first, so overlapping runs never renew twice.
- Provider webhooks run through the common intake (signature checked, tenant found by connected account) and settle payments, holds, refunds and account status outside any database transaction.

**PCI.** No card numbers anywhere: only provider ids, card brand and last four (checked in tests).

**Verified:**
- 285 tests green (domain 110, payments 3, db 124, auth 17, events 5, staff 10, worker 16), plus typecheck, lint and the tenant SQL lint.
- Browser walkthrough 15/15 on the fake provider: onboarding, reader pairing, refund limit, terminal payment waiting then received with the balance updating live on a second screen, bank transfer, hold place, raise and capture, Front Desk refund over the limit blocked and within it done, Payments list, no card columns.

**Review fixes applied:**
- Holds save the card (customer plus setup for later use) so renewal works on Stripe.
- A late poll can no longer reopen a captured hold; a capture lost after a crash is reconciled.
- Cancel at the desk honours a card presented just before.
- Idempotency keys on every money-moving call.
- Hold operations run under the hold's row lock; renewal claims each hold.
- The refund limit is counted per payment.
- Refunds without an answer and refunds waiting for balance are retried.
- Renewal only for stays that outlast the hold, and not straight after placing it.
- A Property Manager onboards; a renewed hold is captured as Tender "card online".
- The webhook processor works outside a transaction; refunds and renewals update open screens.
- An Approval stub for ticket 31 to fill.

**Assumptions (owner to confirm):**
- Stripe Standard accounts through hosted onboarding.
- Front Desk refund limit as a property setting, default 200, counted per payment.
- Holds renewed 48 h before expiry, checked hourly.
- Card Holds go with the right to take payments (Property Manager, Front Desk, Accounting).

**Open points:**
- The Stripe adapter is unverified live until Stripe test keys exist (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET in .env).
- Stripe Support must enable extended, incremental and multicapture holds, and keyed MOTO on Terminal. Until MOTO is enabled, the OTA virtual card tender is refused by the Stripe adapter.
- Readers are chosen per workstation in the browser (remembered per device), not paired server-side.
- Properties carry no address yet: the Legal Entity's address is used for the Terminal location.
- Hold notifications go to the whole tenant (confirmation number only).
- Check-out using the capture comes with ticket 28; Approvals replace the stub in ticket 31.
- Action messages in English only, as elsewhere in the app.
