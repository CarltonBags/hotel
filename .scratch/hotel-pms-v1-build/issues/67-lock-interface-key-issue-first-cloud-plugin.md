# 67 — Lock interface, key issue and revoke, first cloud plugin

**What to build:** One internal lock interface (issue key, extend or modify, revoke, read card, list encoders, health) with Lock Plugins declaring their capabilities; the property sets its lock system, key handover mode (collect at reception default, kiosk encoder, Digital Key, door PIN) and an encoder per desk workstation. Keys are issued only for Checked-in reservations, valid to checkout time plus grace (default 1 hour); extension or late checkout re-encodes or updates; room move issues a new key and revokes the old where the lock is online, otherwise warns that the old card runs to expiry; automatic revoke at check-out, no-show and cancellation; manual for lost keys; all events logged on the reservation. Unsupported locks show "key by lock software". First plugin: Nuki (public cloud API) running in the worker, with a simulated plugin for tests.

**Blocked by:** 26 Check-in with folio posting, Charges and Routing Rules, 13 Worker service: jobs, schedules, live updates and webhook intake

**Status:** in review (PR stacked on ticket 65)

- [ ] Key issued at check-in for a Nuki test lock and revoked at check-out (built; verified with a simulated lock system and a hand-written fake of Nuki's Web API — no Nuki account yet, see Open points)
- [x] Extension updates key validity; room move revokes the old online key
- [x] Property with an unsupported lock sees the fallback text and no key actions
- [x] Plugin capability flags hide unsupported actions

## Comments

**Built:** a new `locks` package with the one lock interface (issue, update, revoke, revoke by our key id, read card, list encoders, health) and Lock Plugins declaring their capabilities: Nuki (Web API keypad codes as door PINs) and a simulated system for tests and development. Settings → Door locks (Property Manager): lock system (an unsupported one by name), key handover (refused where the system cannot do it), grace after check-out time (60 minutes by default), each room's door, an encoder per desk Device. Keys exist only for Checked-in stays and run to check-out time (or the stay's late check-out) plus the grace. Any change of a stay's status, dates, late check-out or rooms, and a new Business Date, queues it by database trigger (whatever path made the change) and wakes the worker at once (LISTEN), which brings its keys in line: door PIN or Digital Key issued at check-in, validity moved on extension or late check-out (an offline card: "write the card again"), new key and the old one revoked on a room move (an offline card runs to its expiry, with a warning), all revoked at check-out, no-show and cancellation. The desk sees the door PIN, writes, reads and revokes key cards, revokes a lost key (a door PIN is replaced) and sets a late check-out. Every key event is logged on the reservation. An unsupported lock shows "key by lock software" and no key actions; capabilities hide what a plugin cannot do. Credentials and PINs are sealed with LOCK_SECRET.

**Verified:** domain `locks.test.ts` (validity, plan for check-in, extension, room move, check-out, offline cards, actions per capability, PIN rules); locks `nuki.test.ts` (requests against a hand-written fake of the Web API, refusals); db `locks.test.ts` (PIN at check-in to check-out plus grace, extension, late check-out, room move on the new Business Date, lost PIN replaced, departure morning, desk card written/read/revoked, check-out revokes, unsupported lock, capabilities); full db suite 363 passed; walkthrough 12/12 in the browser.

**Review fixes:** the queue's lease is a token and a stay is run under its lock (no stuck rows, no double runs); the key keeps its door; a key made at the lock whose answer was lost is taken back by its name; a revoke while a key is being made is honoured; the departure morning keeps the key; assignments moved between stays queue both; Nuki refusals (4xx) are told apart from outages, a 404 on revoke counts as revoked, ids found by a name within Nuki's limit; sealing with its own LOCK_SECRET and a lock-only seal; a changed secret no longer breaks pages; desk encoders only for the property's own Devices; the simulated system hidden in production; late check-out added; offline-card re-encode warning; glossary wording (Digital Key, Encoder).

**Open points:**
- Nuki: no account; the plugin follows the Web API documentation (authorization type 13, names, times) but has not met a real lock.
- LOCK_SECRET must be set in production (the auth secret stands in only in development).
- The kiosk encoder handover and the Digital Key in the Portal come with ticket 69.
