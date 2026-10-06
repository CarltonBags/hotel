# 63 — Spa appointment book and spa sales

**What to build:** Spa Staff manage an appointment book per therapist and treatment room with released slots, book treatments for hotel guests linked to their reservation or for day visitors as Outlet Sales, sell treatments and products with the spa's Tax Codes, and close by room charge or direct payment like any outlet. The desk sees a guest's spa appointments on the reservation.

**Blocked by:** 61 Outlet payments: room charge, readers, tap to pay, cash, vouchers, tips, discounts, voids

**Status:** in review (PR stacked on ticket 62)

- [x] Double-booking a therapist slot is refused
- [x] Treatment for a hotel guest charges the room within the limit
- [x] Day visitor pays directly with a Receipt
- [x] Appointment shows on the reservation tab

## Comments

**Built:** the spa as an outlet kind with therapists, treatment rooms, treatments (a menu item with minutes and whether it needs a room) and therapists' working hours, each released to guests or not. The day's appointment book per therapist on the outlet app (`/outlet/<id>/spa`): book a hotel guest (found by surname or room, stays from today to two months ahead) or a day visitor; a clash with the therapist's other appointments, outside the hours or without a free treatment room is refused, as is a time already passed or a day outside the guest's stay. "To the bill" opens a spa bill with the treatment (more items and products may follow) and marks it given; for a hotel guest the bill opens on Room Charge with the stay already chosen. Cancel and no-show free the slot. Hours can be withheld, released or removed (not while appointments are booked in them). The reservation tab lists the stay's spa appointments. At a spa Spa Staff take orders, not Service.

**Verified:** db `spa.test.ts` (slot never booked twice, room charge within the limit, day visitor with Receipt, appointment on the reservation, billing once under a double click, no-show, hours with bookings kept, Service refused at the spa, past time refused); domain `spa.test.ts` (touching hours, DST-safe local times); walkthrough 8/8 in the browser (setup, hours, booking, clash refused, stay offered for the Room Charge, charged, day visitor's Receipt, appointment on the reservation).

**Review fixes:** billing an appointment serialised per appointment (no second bill on a double click; an empty bill is removed if the item fails); hours insert locks the therapist; spa sales checked per outlet (`servesAt`), staff actions gate on the outlet till right; reads of a reservation's appointments and the spa setup check the viewer; guest search limited and escaped; hours touching each other count as one; local times DST-safe; no-show, hours release/withhold/remove; outlet app texts and times in the user's language; German glossary rows.

**Open points:** day visitors are free-text names (no guest profile); products are sold as ordinary menu items on the same bill.
