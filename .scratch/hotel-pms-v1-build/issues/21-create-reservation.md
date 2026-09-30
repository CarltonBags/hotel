# 21 — Create a reservation with availability and stored prices

**What to build:** From "New reservation", Front Desk enters dates, occupancy (adults plus child ages) and sees availability per room type (availability lives on room types only, ADR 0003) with rate plans and prices; picks a Rate Plan (hidden plans by Rate Code, corporate code attaching the Company), sets the Booker (person or Company) and Primary Guest, Source Direct with walk-in flag, notes; the system stores the price per night per component and creates a Booking with one or more Reservations in state Confirmed with a confirmation number. Occupancy is validated against the room type. The reservation tab shows stay, guests, prices and a placeholder for the folio.

**Blocked by:** 17 Rate Plans, policies, Supplements and Restrictions, 20 Guest profiles and Companies

**Status:** ready-for-agent

- [ ] A room type with zero availability on any night of the stay cannot be booked by this flow
- [ ] A rate change after booking does not change the stored nightly prices
- [ ] A Booking with two Reservations shares Booker and confirmation number and each Reservation has its own guest
- [ ] Supplements applied for 3 adults and one child match the plan
