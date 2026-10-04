# 24 — Calendar Availability view and All-properties view

**What to build:** A toggle in the Calendar toolbar switches to the Availability view: room types by days as a heat map of free rooms with price and restriction marks; selecting a cell lists the reservations behind it. With "All properties" selected the Calendar shows the Availability view with one block per hotel; clicking a block opens that hotel's Calendar.

**Blocked by:** 23 Calendar Rooms view

**Status:** in review (pull request on branch ticket-24-calendar-availability, stacked on ticket-19-rates-grid-tools)

- [x] Availability view numbers equal the room type rows of the Rooms view
- [x] All-properties view shows one block per property the user may access
- [x] Cell selection lists the reservations of that room type and night

## Comments

**Built (2026-10-04).** Calendar prototype variant C.

**Availability view.**
- A Rooms / Availability toggle in the Calendar toolbar; the dates shown are kept.
- Room types by days (7, 14 or 30) as a heat map of free rooms: none left red, two or fewer amber, otherwise green, stop-sell grey. Each cell also shows the lowest public price and the restriction marks, written as in the Rooms view (STOP, 2N, CTA, CTD, ≤7).
- Event Markers are shaded in the header.
- An Occupancy row: occupied rooms of available rooms (Out of Order rooms are neither).
- Selecting a cell opens a panel: free of rooms, staying, leaving, Out of Order, price, then the reservations taking a room that night and those leaving that morning, each with arrives / staying / leaves, nights, status, and a link to the reservation.
- Both views read the same loader, so the numbers agree. The walkthrough checks all 28 cells.

**All properties.**
- With All properties selected, the Calendar shows one Availability block per hotel the user may see reservations of. Each block has prices and marks and is loaded in parallel; no guest data is sent.
- Clicking a block (header or matrix, or Enter) opens that hotel's Calendar in the Availability view on the same dates.
- Front-office users never get All properties.

**Verified:**
- 391 tests green (domain 153, db 182, staff 12), plus typecheck and the tenant SQL lint.
- A database test checks that the stays behind each cell equal rooms − free − Out of Order, also with an Out of Order room.
- Browser walkthrough 4/4: Availability equals the Rooms view type rows; a cell lists that night's reservations as in the database; one block per property; a block opens that hotel's Calendar.

**Review fixes applied:**
- Out of Order rooms shown separately and left out of occupancy.
- Blocks show price and restriction marks.
- Blocks open from anywhere and by keyboard, keep the view and dates, and are guarded against double clicks.
- Hotels load in parallel without guest data.
- Shared restriction marks; shared Occupying statuses.
- `aria-current` on the view links.
- "1 night" singular.
- The view toggle moved to its own module.

**Open points:**
- The All-properties view has no range or previous/next controls yet; `from` and `range` come from the URL.
- Late Arrival has no colour of its own in the cell list (the reservation data does not carry it yet).
- The toolbar (range, previous, today, next) repeats the Rooms view's.

