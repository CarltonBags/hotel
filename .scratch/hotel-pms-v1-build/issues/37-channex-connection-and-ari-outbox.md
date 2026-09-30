# 37 — Channex connection and ARI outbox

**What to build:** A Property Manager connects a property to Channex: property, room types and each (rate plan, room type) pair projected as an external rate plan, mapping kept automatically; per-occupancy prices computed from Supplements; restrictions mapped (minimum stay through where supported). Every rate, restriction, availability and Room Block change writes to a transactional outbox; the worker pushes deltas within about a minute under the rate limits and does a nightly full push; the rates grid header shows "Sending n changes" or "Channels up to date"; failures alert Revenue and Property Manager. The Channex certification tests pass on staging.

**Blocked by:** 18 Rates grid with keyboard entry and bulk edit, 13 Worker service: jobs, schedules, live updates and webhook intake

**Status:** ready-for-agent

- [ ] A grid change reaches Channex staging within a minute; a burst is coalesced under the per-minute limit
- [ ] Out of Order lowers availability at Channex
- [ ] Certification test list passes and is recorded
- [ ] Outbox survives a worker restart without loss or double push
