# Housekeeping model

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 02

## Question

Define Room Status (clean, dirty, inspected, out of order, out of service) and how it interacts with reservations and the front desk. Decide: who changes status and from which surface, daily task generation from arrivals/departures/stayovers, maintenance issues vs housekeeping tasks, and what the front desk needs to see before assigning a room. Resolve the terms into CONTEXT.md.

## Answer

Resolved 2026-09-28 by grilling.

**Room state has three independent dimensions**
- **Cleanliness**: Dirty, Clean, Inspected. Set by housekeeping staff.
- **Occupancy**: Vacant or Occupied. Derived from reservations, never set by hand.
- **Room Block**: Out of Order or Out of Service, with date range and reason.
  - **Out of Order** removes the room from sale for the range: room-type availability drops, the channel manager is updated, and a conflict warning appears if reservations are assigned to the room.
  - **Out of Service** keeps the room sellable but flagged; front desk sees the reason before assigning.

**Inspection** is a per-property setting, default on. With it, only Inspected rooms are ready for a guest; without it, Clean is enough. "Ready" below means whichever applies.

**Automatic Dirty**: at check-out; for the vacated room on a room move; when a Room Block ends; and for every occupied room when the Night Audit closes the day.

**Housekeeping Tasks**
- Generated after the Night Audit: Departure clean, Stayover clean, Arrival preparation, Linen change. Each task type has a time value in minutes per room type.
- Stayover rhythm is a property rule (daily, every second or third day, on request only), optionally per room type; linen change has its own rhythm. The guest may decline cleaning for a day, through the portal or recorded by the housekeeper.
- The system proposes a distribution by **Section** (floor or wing) with balanced minutes; the Housekeeping Supervisor adjusts and publishes. Early departures, room moves and new arrivals update tasks during the day.
- Rooms of guests who are Arrived, Waiting for Room get a priority flag.

**Roles**: the fixed property role set grows from five to seven. Housekeeping splits into **Housekeeper** (own tasks, sets Clean, reports issues, records extras) and **Housekeeping Supervisor** (assigns, inspects, manages Sections, sees the whole property). **Maintenance** is added. This amends "Tenancy, property and role model".

**Surfaces**: Housekeeper and Maintenance get a phone-first view inside the staff app (own rooms or issues as large cards, one-tap status change, report issue with photo). Supervisors use the normal shell.

**Maintenance Issues**: anyone can report one for a room or public area, with photo and urgency. Maintenance staff work their queue (open, in progress, done). An issue may carry a Room Block.

**Front desk**
- A Room Assignment can be made at any time, whatever the cleanliness, except into an Out of Order range.
- Check-in into a room that is not ready shows a warning and needs confirmation with a reason; it is logged. Self Check-in never overrides.
- The room picker shows: cleanliness and expected ready time (task assigned or in progress), blocks and open Maintenance Issues, **Room Features** (floor, view, bed type, connecting door, accessible, balcony) matched against guest preferences, and the next reservation in that room so a forced later room move is visible.

**Housekeeper extras in v1**: minibar posting (consumed items become Charges on the guest folio, from the Service catalogue), lost and found (item, photo, room, date, last guest, returned or disposed), guest declined or do-not-disturb (task closes as skipped, visible to supervisor).

- ADR: `docs/adr/0011-room-state-three-dimensions.md`.
