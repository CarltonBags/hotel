# 23 — Calendar Rooms view

**What to build:** Front Desk works in the Calendar decided by the prototype: one row per room grouped by room type, room type rows showing free rooms and lowest price per day with restriction marks (amber low, red none) and folding their rooms; an unassigned lane per type with dashed bars; bars from midday of arrival to midday of departure with surname, guest count, balance dot and status colour; weekend and Event Marker shading; a line at the open Business Date; 7, 14 or 30 days visible with scrolling; a footer summary with "Open as tab". Dragging to another room of the same type on the same dates applies at once with a 10-second Undo; to other dates or types shows old and new dates and the price difference first; dropping an unassigned reservation assigns it; refused drops explain why. A filter bar by room type, floor or Section, Room Feature, cleanliness, arrivals today and unassigned only. Rows are virtualised for 400 rooms.

**Blocked by:** 22 Edit, move and cancel reservations with audit log and forced overbooking

**Status:** done

- [x] Matches docs/design/calendar variant A
- [x] Drag rules verified: same-type move at once with Undo, date change confirmed, refused cases messaged
- [x] 400 rooms by 30 days scrolls smoothly with virtualised rows
- [x] Filter "unassigned only" shows only the lanes

## Comments

**Done (2026-10-02).** Calendar module at `/calendar` (right `view_reservations`; dragging needs `manage_reservations`), built from prototype variant A: rows per room grouped by room type; type rows with free rooms, lowest price still on sale and its marks (2N, CTA, CTD, ≤7, struck when stop-sold), amber at 2 or fewer, red at none, folding their rooms; unassigned lane per type with dashed bars packed into lanes; bars from midday of arrival to midday of departure with surname, guest count, status colour (Confirmed, Checked-in, Checked-out) and a red ring when overbooked; weekend shading; a line at today; 7/14/30 days with 45 days loaded and scrolling; prev/next/today; footer summary with "Open as tab". Domain `calendar.ts`: `dropOutcome` (every drag rule as data) and `packLanes`. DB: `loadCalendar`; `previewReservationChange` (dry run, no locks); `changeStayIntoRoom` (date or type change plus room in one transaction, refused if the price differs from the preview); `restoreAssignments` (Undo: whole-stay or none, only while the drag's result is still there). Rows are virtualised (only rows within 400 px of the viewport are in the DOM).

**Verified:** 205 tests green, typecheck, builds, tenant SQL lint. Browser walkthrough 12/12: type rows with free rooms and prices; unassigned lane and today line; drop on a room assigns, Undo restores; drop on a taken room refused with a message; same-type move at once; date drop shows old and new dates and the price difference, then moves stay and room; "unassigned only" shows only lanes; footer opens the reservation as a tab; 400 rooms × 30 days renders 35 of 401 rows, average frame 16 ms.

**Review fixes applied:** later parts of a moved stay keep their nights and room type; checked-in moves start today and refuse slept nights (client check matches the server); drag confirmation atomic and price-checked; Undo validated and stale-checked; footer reads fresh data; lowest price skips stop-sold plans; checked-out bars explain the refusal; live regions always mounted; queries in one transaction run in sequence.

**Left out (dependencies):** Room Blocks (Out of Order / Out of Service), cleanliness filter (housekeeping tickets), balance dot (folio, ticket 26), Event Marker shading (ticket 19), Late Arrival colour (set by Night Audit), Availability view and "All properties" (ticket 24). Dragging a bar's edge was not prototyped. Drag-and-drop has no keyboard path in the grid itself; the same changes are possible by keyboard on the reservation tab.

**Open points:** the line marks the property's date until Night Audit provides the Business Date; `calendar-rooms.tsx` is large (filters, virtualisation, drag, dialog, footer) and could be split when ticket 24 adds the Availability view.
