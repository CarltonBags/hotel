# 21 — Create a reservation with availability and stored prices

**What to build:** From "New reservation", Front Desk enters dates, occupancy (adults plus child ages) and sees availability per room type (availability lives on room types only, ADR 0003) with rate plans and prices; picks a Rate Plan (hidden plans by Rate Code, corporate code attaching the Company), sets the Booker (person or Company) and Primary Guest, Source Direct with walk-in flag, notes; the system stores the price per night per component and creates a Booking with one or more Reservations in state Confirmed with a confirmation number. Occupancy is validated against the room type. The reservation tab shows stay, guests, prices and a placeholder for the folio.

**Blocked by:** 17 Rate Plans, policies, Supplements and Restrictions, 20 Guest profiles and Companies

**Status:** done

- [x] A room type with zero availability on any night of the stay cannot be booked by this flow
- [x] A rate change after booking does not change the stored nightly prices
- [x] A Booking with two Reservations shares Booker and confirmation number and each Reservation has its own guest
- [x] Supplements applied for 3 adults and one child match the plan

## Comments

**Done (2026-10-02).** Tenant migration 0008: `bookings` (confirmation number from a tenant sequence starting 100001, Booker person or Company, Source Direct/Channel with walk-in flag, Rate Code and the Company it attaches, notes), `reservations` (room type, rate plan, dates, adults, child ages, status, Primary Guest), `reservation_nights` and `reservation_night_components` (room remainder and included Services per person, stored at booking). Domain `quoteStay`: occupancy against the room type, Availability (fewest free rooms over the nights), Restrictions (stop sell, closed to arrival on arrival, closed to departure on departure date, minimum stays, maximum stay, derived inheritance), price with Supplements, split into components. DB: `quoteStays` (per room type: free rooms, public plans plus plans of the entered Rate Code), `createBooking` (re-quotes under the property lock, counts rooms the same booking already takes, refuses past arrivals, walk-ins on another day and prices that changed since shown), `findReservation`, `listGuestReservations`. Rights `view_reservations` (PM, FD, AC, RV), `manage_reservations` (PM, FD), `view_folio` (PM, FD, AC). Screens: New reservation (search, rooms with own dates and occupancy in a cart kept across searches, guest search or name-only new guest, Booker room-1 guest / another person / Company, walk-in, notes), reservation record tab (stay, guests, Booker, other rooms, prices per night and component, folio placeholder; notes and folio hidden from Revenue), stays on the guest profile.

**Verified:** 187 tests green (domain 68, db 73, auth 17, staff 10, worker 14, events 4), typecheck, builds, tenant SQL lint. Browser walkthrough 10/10: availability with plans and prices; cart keeps room 1 (2 adults) across a new search for room 2 (1 adult); booking opens the reservation as a record tab with confirmation number; room 2 shares Booker and number with its own guest; rates set to 999 afterwards leave stored totals; availability shows 19 of 21; guest profile lists the stay.

**Review fixes applied:** Rate Code Company stored on the booking; Booker may be any person; per-room dates and occupancy; server refuses past arrivals, walk-ins not arriving today and prices that changed since shown; inline guest creation lets session redirects through and records the navbar property; booking input shape-checked; folio behind `view_folio`; guest search shows contact data only with `view_guest_contacts`; profile lists reservations only at properties the user may see; notes hidden from Revenue; German "Buchungsquelle"; avoided terms renamed (inventory, stay); Drizzle names match the migration, sequence declared; shared `isUuid`, `lockProperty`, `ReservationStatus`.

**Open points:**
- Included services count every person, babies included (owner to decide whether free Age Bands are excluded).
- Server error texts for unbookable stays are English (the screen translates the reasons it shows).
- Additional guests beyond the Primary Guest, room assignment, edits and cancellation: tickets 22 and 23. Ticket 22's writers must take the same property lock.
- Overbooking past availability with confirmation is not in this flow.
