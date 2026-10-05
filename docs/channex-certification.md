# Channex certification record (ticket 37)

Channex certifies a PMS integration on its staging environment: the PMS team runs the test cases, submits the
form, then Channex engineers reproduce the actions live in the PMS's own screens. Timer-based full syncs,
scripts and one call per date are disqualifying. Source: docs.channex.io "PMS Certification Tests", summarised in
`docs/research/channel-manager-selection.md` [C8].

Status: **built and tested against the in-memory channel manager; the staging run is pending** (owner: create the
Channex staging account and put `CHANNEX_API_KEY` in `.env`; then run the cases below and fill in the result column).

| Requirement | How Hoteloftware meets it | Automated check | Staging result |
|---|---|---|---|
| Full sync of 500 days in two calls (availability, then rates and restrictions) | Connecting, the nightly full push and "Send everything again" queue every room type and pair for 500 days from the Business Date; one push sends one availability call and one restrictions call, days with equal values compressed to ranges | `packages/db/test/channels.test.ts` "connecting projects…" | pending |
| Single date change sends that date only (delta updates) | Database triggers write the changed rows' dates to the ARI outbox; the push sends only those days | "a burst of grid changes…" | pending |
| Several changes at once go batched | All waiting rows of a property go in one call per kind | "a burst of grid changes…" (15 rate edits and a restriction → one call) | pending |
| Rates per occupancy | Per-person sell mode; one rate per adult count from the base rate and the Single and Extra-adult Supplements | `packages/domain/test/channels.test.ts` | pending |
| Restrictions: stop sell, closed to arrival/departure, minimum stay arrival and through, maximum stay | Sent per date from the stored restrictions, derived plans with inherited fields resolved | "a burst of grid changes…" (min stay through) | pending |
| Availability changes from bookings, cancellations, Out of Order, room count | Triggers on reservations, room assignments, Room Blocks and rooms | "a booking and an Out of Order block…" | pending |
| Respect the rate limit (20 ARI calls per minute per property, 10 + 10) | At most one availability and one restrictions call per property per minute; a 429 keeps the rows for the next run | "a failing push…" | pending |
| No timer-based full syncs | Changes are event-driven; the only full push is the nightly one Channex allows | — | pending |
| Booking intake: new, modified, cancelled test bookings acknowledged | Ticket 38 | — | ticket 38 |
| Feature declaration form | To fill in with the staging run | — | pending |
