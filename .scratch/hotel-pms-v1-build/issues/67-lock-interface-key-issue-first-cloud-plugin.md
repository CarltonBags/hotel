# 67 — Lock interface, key issue and revoke, first cloud plugin

**What to build:** One internal lock interface (issue key, extend or modify, revoke, read card, list encoders, health) with Lock Plugins declaring their capabilities; the property sets its lock system, key handover mode (collect at reception default, kiosk encoder, Digital Key, door PIN) and an encoder per desk workstation. Keys are issued only for Checked-in reservations, valid to checkout time plus grace (default 1 hour); extension or late checkout re-encodes or updates; room move issues a new key and revokes the old where the lock is online, otherwise warns that the old card runs to expiry; automatic revoke at check-out, no-show and cancellation; manual for lost keys; all events logged on the reservation. Unsupported locks show "key by lock software". First plugin: Nuki (public cloud API) running in the worker, with a simulated plugin for tests.

**Blocked by:** 26 Check-in with folio posting, Charges and Routing Rules, 13 Worker service: jobs, schedules, live updates and webhook intake

**Status:** ready-for-agent

- [ ] Key issued at check-in for a Nuki test lock and revoked at check-out
- [ ] Extension updates key validity; room move revokes the old online key
- [ ] Property with an unsupported lock sees the fallback text and no key actions
- [ ] Plugin capability flags hide unsupported actions
