# 64 — Spa self-booking in the Guest Portal

**What to build:** A guest with a Portal Link books treatments in the slots the spa has released, sees confirmation and can cancel within the spa's rule; the appointment is linked to the reservation and charged to the room at the visit.

**Blocked by:** 63 Spa appointment book and spa sales, 40 Guest Portal with Portal Link and Pre-check-in

**Status:** in review (PR stacked on ticket 63)

- [x] Guest sees only released slots and cannot book a taken one
- [x] Booking appears in the spa book at once (live update)
- [x] Cancellation past the spa's deadline is refused with the rule shown

## Comments

**Built:** a Spa section in the Guest Portal of a stay (confirmed or checked in, Point of Sale Module on, an active spa with treatments): the days of the stay still to come, a treatment, and the free start times every 30 minutes inside the hours the spa released, where a therapist and (if needed) a room are free. Booking takes the first therapist free then; the appointment belongs to the reservation, is marked "Guest Portal" in the spa book, and at the visit the spa bill opens on Room Charge with the stay chosen. A guest has one treatment at a time and at most 10 booked. The guest cancels up to the spa's hours before (set per spa in its setup, default 24); later the rule is shown and a late request is refused with it. Bookings and cancellations, from the Portal or the spa, update open spa books live: the outlet app gained a data-only event stream (the shell's notification stream and it share one implementation).

**Verified:** db `portal-spa.test.ts` (only released free times, a taken time refused, unreleased therapists not offered, the booking on the spa's book, one treatment at a time, cancellation past the deadline refused with the rule, cancelling frees the time); domain `spa.test.ts` (cancellation deadline); full db suite 353 passed; walkthrough 9/9 in the browser (free times only, confirmation, booking on the open spa book without reload, marked as Portal booking, taken time gone, cancellation hours saved, rule shown past the deadline, guest cancels and the book updates).

**Review fixes:** refusals are typed (taken, passed, clash, too many, unavailable, not found, too late, no longer) and shown in the guest's language, and only a therapist's "not free" moves on to the next therapist (a passed time is no longer reported as taken); the departure day is not offered (the room is no longer charged then) and the server takes only times still to come on an offered day; hours past midnight list under the next day; a checked-out or cancelled stay no longer cancels through the link; the cancellation hours come with each appointment; the deadline is one domain rule; the event stream keeps its last id across reopenings (the shell's notifications too), and the outlet app says when live updates are off; glossary wording (Appointment, not booking).

**Open points:** the cancellation hours per spa, the cap of 10 booked treatments per stay and "one treatment at a time" are our choices where the spec only says "the spa's rule"; the owner may want them different. No-shows now free the therapist and room (as ticket 63 intended).
