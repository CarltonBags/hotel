# 33 — Room state, Room Blocks and the room picker

**What to build:** Rooms carry Cleanliness (Dirty, Clean, Inspected), derived Occupancy and dated Room Blocks (ADR 0011). Out of Order removes the room from sale for its range (availability drops, channel update queued later, conflict warning on assigned reservations); Out of Service keeps it sellable but flagged. Automatic Dirty at check-out, on room move, when a block ends and at audit close. Inspection setting per property, default on. The room picker shows cleanliness with expected ready time, blocks and open issues, Room Features matched against guest preferences, and the next reservation in the room. Check-in into a room that is not ready warns and needs a reason; assignment into an Out of Order range is refused. Per-role rights as in the matrix (Front Desk may set Clean and Inspected).

**Blocked by:** 28 Invoices with gap-free numbering, ZUGFeRD PDF, Deposit Invoice and check-out

**Status:** in review (pull request on branch ticket-33-room-state, stacked on ticket-32-night-audit)

- [x] Out of Order on 2 of 10 rooms of a type lowers availability to 8 for those nights
- [x] Check-out sets Dirty; a non-ready check-in is logged with reason
- [x] Room picker sorts rooms matching the guest's preferences first
- [x] Housekeeper role can only see and set its own rooms via API

## Comments

**Built (2026-10-04).**

**Cleanliness and Occupancy.**
- Rooms carry Cleanliness (Dirty, Clean, Inspected; a new room starts Inspected) with a log of every change and its source.
- Occupancy is derived from the stays assigned on the Business Date, never stored.
- Inspection per property, default on (Property Manager): only Inspected rooms are ready; without it Clean is enough.

**Room Blocks.**
- **Out of Order:**
  - Takes the room out of sale for its nights (quotes, stay changes, Calendar, Today and the audit's occupancy). A room a stay still holds is counted once.
  - Assignment into it is refused, and so is check-in.
  - The stays assigned on blocked nights are returned when the block is set and stay listed on the block until moved.
- **Out of Service** only flags.
- A block cancelled before it began counts for nothing. One shared Out of Order test is used everywhere.

**Automatic Dirty:**
- at check-out;
- on an in-house move from tonight (the room left);
- when a block in force is ended;
- at the Night Audit close, for occupied rooms and blocks ending with the night.

**Check-in into a room not ready** is refused until staff confirm with a reason, logged with the check-in.

**Room picker:**
- Cleanliness and readiness, the day's Housekeeping Task, Room Blocks, and the next stay in the room.
- The features the guest's preferences mention (matched by feature name or code in the guest's preferences text) are starred, and such rooms come first among the free ones.
- Out of Order rooms cannot be picked.

**Rooms page** (Housekeeping → Reinigungsstatus):
- Filters: all, dirty, not ready, blocked. Each card can set Cleanliness, block and unblock, and give the day's Housekeeping Task to a Housekeeper of the property.
- Floor view only: surname, dates, number of guests.
- Rights follow the matrix: a Housekeeper sees and sets only own rooms, never Inspected; Front Desk may set Clean and Inspected and Out of Service; Out of Order is Property Manager, Housekeeping Supervisor and Maintenance.

**Verified:**
- 365 tests green (db suite 165), plus typecheck and the tenant SQL lint.
- Browser walkthrough 6/6: Cleanliness on the Rooms page; Out of Order block shown; a check-in into a Dirty room asks for a reason and logs it; check-out turns the room Dirty.

**Review fixes applied:**
- One Out of Order test (a cancelled block no longer counts); no double count of a held room.
- Check-in refused into an Out of Order room; nights already slept are not checked against later blocks.
- The assignee must be a Housekeeper of the property; the Cleanliness word is translated in the not-ready prompt.
- Property lock first for blocks; the inspection setting is checked in the database.
- Block conflicts kept on the block; floor view without first names.
- A real test of the in-house move.

**Open points:**
- Expected ready time and task generation come with ticket 34 (the minimal Housekeeping Task here defines a Housekeeper's own rooms); open Maintenance Issues in the picker with ticket 36; availability changes to the channel manager with ticket 37.
- Guest preferences are free text: matching by feature name or code can miss or over-match; structured preferences can replace it later.
- Setting Out of Order on a fully sold room type gives no warning about unassigned stays (only assigned ones are listed).

