# Reservation and inventory domain model

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: -

## Question

Define the core booking objects: Room Type, Room, Availability, Reservation, Stay, Guest, and their lifecycle (inquiry, confirmed, checked-in, checked-out, cancelled, no-show). Decide: does availability live at room-type level with room assignment later, how multi-room bookings are modelled, whether overbooking is allowed, how a reservation moves between rooms mid-stay, and what a Guest profile is versus a booker. Stress-test with scenarios (walk-in, extension, early departure, split stay). Resolve the terms into CONTEXT.md.

## Answer

Resolved 2026-09-24 by grilling.

- **Room Type** is the unit of availability: a reservation consumes one unit of a room type per night. **Room** is a physical unit of a room type. Availability lives only on room types (channel-manager constraint), never on rooms.
- **Room Assignment** links a reservation to a room for a date range. Assignment may happen any time before check-in; a mid-stay room move adds a new assignment segment on the same reservation (one reservation, one folio, one confirmation). Rate may differ per segment.
- **Booking** is the commercial umbrella: Booker (a person or a Company), Source, confirmation number, shared notes. It contains one or more **Reservations**, each = one room type x date range x occupancy, with a **Primary Guest** and additional Guests. Cancel/modify per reservation or whole booking.
- **Occupancy**: adults count plus a list of child ages; validated against room-type max occupancy and max adults.
- **Lifecycle**: Confirmed, Checked-in, Checked-out, Cancelled, No-show. No Tentative/option state in v1 (holds handled outside the system).
- **Date, occupancy and room-type changes** are in-place edits with availability re-check for the new nights, rate recalculation for changed nights only, and a full audit log (who, when, before/after).
- **Overbooking**: booking engine and channel sync never oversell; Front Desk or Manager may force a reservation past availability with an explicit confirmation, flagged on the dashboard.
- **No-show** is set by the **Night Audit**: every Confirmed reservation with arrival on the business date and not checked in is proposed as no-show; the user running the audit can exclude individual reservations (late flights, group stragglers) before the audit marks the rest. This makes Night Audit a v1 feature, ticketed separately.
- **Source**: enum Booking Engine, Direct, Channel; Channel carries the OTA name from the channel manager; walk-in is Direct with a flag.
- **Guest** profiles are tenant-wide: known at every property of the tenant, with stay history across the chain, duplicate detection on email/phone/name+date of birth at creation, and manual merge by staff.
- ADRs: `docs/adr/0003-booking-reservation-room-assignment.md`, `docs/adr/0004-tenant-wide-guest-profiles.md`.

> Update 2026-09-29 from "Tourism statistics reporting duties": every guest, including companions and German nationals, needs a **country of residence** as its own field beside nationality, and residents of Austria and Germany a postal code. Registration forms cannot supply this, since they skip German nationals and count companions only. Also needed: actual nights per person, an exclusion flag with reason for the statistics, bed places and extra beds per room with dated history, and an opening calendar per property.

> Update 2026-09-29: with no booking page of ours, Source has two values: Direct (entered by staff, including walk-in) and Channel (booking sites and the hotel's own website tool, carrying their name).
