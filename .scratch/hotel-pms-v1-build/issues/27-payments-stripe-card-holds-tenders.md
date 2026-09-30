# 27 — Payments: Stripe onboarding, Card Holds, Tenders and refunds

**What to build:** A Property Manager onboards the Legal Entity to a Stripe connected account (direct charges) and pairs Stripe Terminal readers per workstation. Front Desk takes a Payment on a Folio by Tender: card terminal, bank transfer, on account, OTA virtual card keyed as MOTO, OTA collect; refunds are negative Payments linked to the original, with the Front Desk limit and Approval above it wired in ticket 31. A Card Hold is a pre-authorisation tracked with its expiry; the system warns before expiry and re-authorises; incremental holds are capped so incidentals are batched; holds are captured at checkout. Payment provider sits behind a provider-agnostic interface (research: Adyen as fallback).

**Blocked by:** 26 Check-in with folio posting, Charges and Routing Rules

**Status:** ready-for-agent

- [ ] Terminal payment posts a Payment and the folio balance updates live
- [ ] A Card Hold shows its expiry and produces a warning job before it
- [ ] Refund above the property limit is blocked until ticket 31 supplies Approval (stub returns denied)
- [ ] Card numbers never touch our servers (tokens only), verified by code review and tests
