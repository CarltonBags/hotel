# Calendar (room plan) screen prototype

Map: ../map.md
Type: prototype
Status: resolved
Blocked by: 15

## Question

What should the Calendar, the room-by-date plan that front desk lives in, look like and how does it behave inside the chosen shell? Prototype variants on the real shell: rows by room grouped by room type vs rows by room type with unassigned reservations on top; day width and visible range (7, 14, 30 days); what a reservation bar shows (guest, status colour, balance, source); drag to move or extend a reservation and assign a room; how availability and rate per room type per day are shown in the same view; behaviour at 400 rooms (virtualised scrolling, collapse by floor or type); multi-property view.

## Answer

Resolved 2026-09-28 by prototype; verdict given by the product owner in the browser.

**Two views in one Calendar, switched by a toggle in its toolbar**
1. **Rooms view** (variant A, main): one row per room, grouped by room type. This is where front desk assigns, moves and extends.
2. **Availability view** (variant C): room types by days as a heat map of free rooms with price and restriction marks; selecting a cell lists the reservations behind it. This is the planning view across many weeks.
The day agenda (variant B) was dropped; Today and Arrivals already cover it.

**Rooms view**
- Room type rows show free rooms and lowest price per day, with restriction marks; low availability in amber, none in red. They fold their rooms.
- Unassigned reservations sit in a lane above the rooms of their type, drawn with a dashed outline.
- A reservation bar starts at the middle of its arrival day and ends at the middle of its departure day, so same-day turnover is visible. It shows surname, number of guests and a dot for an open balance. Colour is the status: Confirmed, Checked-in, Checked-out, Late Arrival.
- Room Blocks are drawn in the room's row: Out of Order solid and hatched, Out of Service dashed.
- Weekend and event days are shaded; a line marks the open Business Date.
- Visible range 7, 14 or 30 days; the timeline scrolls beyond it.
- Selecting a bar shows its summary in a footer with "Open as tab".

**Dragging**
- To another room of the same type on the same dates: applied at once, with Undo offered for 10 seconds.
- To other dates or another room type: a confirmation shows old and new dates and the price difference before anything changes. Added nights are priced at current rates.
- Dropping an unassigned reservation on a room assigns it.
- Refused with a message: a room already taken on those nights, an Out of Order range, a checked-out stay, the arrival date of a checked-in stay.
- Extending or shortening by dragging a bar's edge follows the date-change rule. Not prototyped.

**Large hotels**: a filter bar by room type, floor or Section, Room Feature, cleanliness, "arrivals today" and "unassigned only". Chosen by the owner as the one aid for v1; remembered folding, jump-to-room and a density setting were offered and not chosen.

**Several properties**: the Rooms view needs one selected property. With "All properties" selected the Calendar shows the Availability view with one block per hotel; clicking opens that hotel's Calendar.

**Seen in the prototype at 378 rooms and 30 days**: all rows rendered without virtual scrolling and stayed usable on the test machine; the build should still virtualise rows. With many unassigned reservations the lane pushes the rooms far down, which is why "unassigned only" is in the filter bar.

Assets:
- Screenshots: `docs/design/calendar/`.
- Prototype: `apps/staff-shell-prototype`, route `/prototype/calendar?variant=A|B|C`, params `range=7|14|30`, `rooms=400`. Code in `components/prototype/calendar/`. Uncommitted.
