# 23 — Calendar Rooms view

**What to build:** Front Desk works in the Calendar decided by the prototype: one row per room grouped by room type, room type rows showing free rooms and lowest price per day with restriction marks (amber low, red none) and folding their rooms; an unassigned lane per type with dashed bars; bars from midday of arrival to midday of departure with surname, guest count, balance dot and status colour; weekend and Event Marker shading; a line at the open Business Date; 7, 14 or 30 days visible with scrolling; a footer summary with "Open as tab". Dragging to another room of the same type on the same dates applies at once with a 10-second Undo; to other dates or types shows old and new dates and the price difference first; dropping an unassigned reservation assigns it; refused drops explain why. A filter bar by room type, floor or Section, Room Feature, cleanliness, arrivals today and unassigned only. Rows are virtualised for 400 rooms.

**Blocked by:** 22 Edit, move and cancel reservations with audit log and forced overbooking

**Status:** ready-for-agent

- [ ] Matches docs/design/calendar variant A
- [ ] Drag rules verified: same-type move at once with Undo, date change confirmed, refused cases messaged
- [ ] 400 rooms by 30 days scrolls smoothly with virtualised rows
- [ ] Filter "unassigned only" shows only the lanes
