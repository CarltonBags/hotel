# 37 — Channex connection and ARI outbox

**What to build:** A Property Manager connects a property to Channex: property, room types and each (rate plan, room type) pair projected as an external rate plan, mapping kept automatically; per-occupancy prices computed from Supplements; restrictions mapped (minimum stay through where supported). Every rate, restriction, availability and Room Block change writes to a transactional outbox; the worker pushes deltas within about a minute under the rate limits and does a nightly full push; the rates grid header shows "Sending n changes" or "Channels up to date"; failures alert Revenue and Property Manager. The Channex certification tests pass on staging.

**Blocked by:** 18 Rates grid with keyboard entry and bulk edit, 13 Worker service: jobs, schedules, live updates and webhook intake

**Status:** in review (PR stacked on ticket 36)

- [x] A grid change reaches Channex staging within a minute; a burst is coalesced under the per-minute limit
- [x] Out of Order lowers availability at Channex
- [ ] Certification test list passes and is recorded
- [x] Outbox survives a worker restart without loss or double push

## Comments

**Built**
- New channels package: the channel manager interface; Channex over its REST API; an in-memory stand-in for development and tests. Production refuses to run without the key.
  - Channex covers properties, room types, rate plans sold per person, availability and restrictions.
  - Values go in calls of at most 2,000 each.
  - Rate limits and server errors are retried; refusals are not.
- **Connecting** (Property Manager; support cannot) creates the property at Channex with its room types and one external rate plan per (rate plan, room type) pair sold on channels.
  - The Channex property id is registered for the webhook intake of ticket 38.
  - A failed attempt is cleared, so the next attempt starts over.
- **The mapping is kept on every push:**
  - new pairs are created and pushed in full;
  - changed room counts are sent;
  - a room type with more adults gets new occupancy options and all prices again;
  - a pair taken off channels (plan off channels or inactive, room type removed) is closed at Channex for the whole horizon, then dropped;
  - Channex's per-property limits (20 room types, 200 rate plans) are checked.
- **Outbox:** database triggers write to the ARI outbox in the same transaction as the change, on:
  - rates and restrictions;
  - reservations (dates, room type, status);
  - room assignments, Room Blocks, rooms added, removed or moved;
  - Supplements.
- **Push:** the worker pushes each connected property every minute, one run per property at a time.
  - It sends the current values of the changed days, compressed into ranges: availability first, then restrictions, each marked sent once Channex took it.
  - Prices per adult count come from the base price and the Supplements.
  - A day without a price is closed. Derived plans follow their base for inherited restrictions.
  - A burst becomes one call per kind.
- **Failures:**
  - a retryable failure keeps the rows for the next run;
  - a refused value is set aside with its reason, so it does not hold back the rest; the nightly full push sends it again;
  - Revenue and the Property Manager are told once per failure streak (quiet for an hour against flapping).
- **Nightly full push** of 500 days. Sent rows are kept a week.
- **Non-payment:** unpaid from day 60, or after the contract ended, sales are closed at the channels and changes wait. When it is paid, everything goes in full.
- **Rates grid header:** "Sending n changes", or "Channels up to date · time". It refreshes every 20 seconds and shows a failure with its reason.
- **Settings → Channels:** connect, what is mapped, refused changes, closed sales, "Send everything again".
- **Certification:** the record is in `docs/channex-certification.md`, with a staging script (`channex:staging`) that makes each ARI change the way the app does and prints what Channex answered.

**Verified**
- Domain: ranges of equal days, prices per occupancy from Supplements, closed days without a price, header texts.
- Channex: payload and API key, retryable or not.
- DB tests:
  - connect and push the 500-day horizon in one call per kind;
  - 15 grid edits and a restriction become one call with only the changed days;
  - a booking and an Out of Order block lower availability;
  - a failing push keeps rows and tells once; a refused value is set aside;
  - a new plan mapped; a withdrawn plan closed and dropped;
  - more adults updates the occupancies;
  - non-payment closes sales, and paying reopens them in full;
  - one push per property at a time.
- Worker: failure told to Revenue, not the desk.
- All packages typecheck and pass.
- Walkthrough (10/10):
  - connect from the settings page, 5 mappings, full push within two minutes;
  - grid header up to date, then "Sending 2 changes", sent within a minute;
  - an Out of Order block pushed;
  - worker stopped with changes waiting, then sent after the restart with nothing left claimed.

**Review fixes**
- **Withdrawn plans:** plans taken off channels or deactivated stayed open at the booking sites. They are now closed and dropped.
- **Adult counts:** occupancy options are updated when a room type's adults change, instead of failing every minute.
- **Overlap:** connecting and pushing could run at the same time and leave duplicates at Channex, or send older values last. One run per property now (a lease), and connecting takes the connection first.
- **Refusals:** a refused value no longer blocks the property; it is set aside with the reason.
- **Partial sends:** availability and restrictions are marked separately, so one failing kind does not resend the other. Claims after a crash expire after two minutes, not ten.
- **Non-payment:** unpaid tenants from day 60 and ended tenants no longer keep selling.
- **Fewer outbox rows:** room cleaning and reservation notes no longer write to the outbox; only type moves and stay changes do.
- **Smaller fixes:**
  - closed days carry no prices;
  - children = occupancy minus adults;
  - large pushes are split into calls;
  - the horizon has one definition;
  - the page reads everything in one query;
  - the outbox is pruned;
  - the header refreshes and shows the time.
- **Certification:** a staging script and a step-by-step record.

**Open points**
- **Certification:** the staging run needs the owner's Channex staging key. Until it has been run and the result column filled, the certification box stays open. The booking test cases come with ticket 38.
- **Payload shapes:** the Channex payload follows the public docs. It is to be confirmed on staging that a stop-sell value without rates is accepted for per-person plans.
- **Fake in development:** without a key, development and tests use the in-memory channel manager.
- **Manual full push:** "Send everything again" is a staff action, not a timer. Use it rarely during certification.
