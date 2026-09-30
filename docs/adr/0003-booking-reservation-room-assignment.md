---
status: accepted
---

# Booking holds Reservations; Reservations hold Room Assignments

A Booking is the commercial umbrella (booker, source, confirmation number); each Reservation inside it is one room type for one date range and owns one or more folios (see ADR 0009 and the folio ticket); a Reservation is linked to physical rooms through date-ranged Room Assignments, so a mid-stay room move adds a segment instead of splitting the reservation. We chose this three-level shape over a flat "reservation with room lines" because multi-room bookings need per-room dates, guests and cancellation, and over "split on room move" because guests, channel managers and invoices all expect one continuous stay. Availability is counted on room types only, which is what every channel manager and booking engine requires.
