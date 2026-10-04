# 34 — Housekeeping Tasks, Sections and the supervisor board

**What to build:** After the Night Audit the system generates Housekeeping Tasks (departure clean, stayover clean, arrival preparation, linen change) with minutes per room type, following the property's stayover and linen rhythms (optionally per room type); early departures, room moves and new arrivals update tasks during the day; waiting guests give priority. The Housekeeping Supervisor sees the desktop board: one column per housekeeper plus Unassigned, rooms as chips dragged between columns, minutes against shift length, the morning proposal balanced by Section as a draft until Publish; a started task cannot be moved without confirmation. Inspection: rooms set to Clean are listed; Inspected in one tap or back to Dirty with reason and photo.

**Blocked by:** 32 Night Audit and Business Date, 33 Room state, Room Blocks and the room picker

**Status:** in review (pull request on branch ticket-34-housekeeping-tasks, stacked on ticket-33-room-state)

- [x] Tasks generated for a demo day match the rhythm rules and the arrivals
- [x] Publish makes the plan visible to housekeepers; changes after Publish are marked Changed
- [x] Minutes per person sum correctly against the shift
- [x] Inspection failure returns the room to the housekeeper's list

## Comments

**Built (2026-10-04).**

**Tasks for the Business Date:**
- Departure clean (in the room slept in, also for an early departure and for the room left on a move from tonight).
- Stayover clean by rhythm: daily, every second or third day, or on request.
- Arrival preparation (Late Arrivals included).
- Linen change every N nights.
- Rhythms and minutes per room type override the property's (linen 0: none for that type). Extra cleans by hand or after a failed inspection.

**Generation and updates.** Generated at the Night Audit close; kept in step whenever stays change: check-in, cancelled check-in, check-out, stay edits and room moves, undo, cancellations, new bookings, Arrived and Waiting for Room. A task no longer needed is dropped from the draft, or called off visibly (skipped, Changed) once published and assigned.

**Plan.**
- A draft until Publish; Housekeepers see their rooms only once published. Every later change (new or moved task, priority, failed inspection, called-off task) is marked Changed.
- Rooms move as a whole; a started task moves only with confirmation and starts afresh.
- The morning proposal goes by Section, biggest first, balanced by minutes against the shift. A room already partly given stays with that person, and the order is fixed (same day, same proposal).

**Waiting guests.** "Guest is here, waiting for the room" on the reservation makes its arrival preparation a priority, outlined and first on the board.

**Inspection.**
- Rooms set to Clean are listed: Inspected in one tap, or back to Dirty with a reason.
- The work done goes back to the housekeeper's list (open, Changed); without a task, an extra clean goes to whoever set it Clean.

**Housekeepers' steps** (for the phone view, ticket 35): start, done (sets Clean), skip (stayover or linen: guest declined, do not disturb). Only on today's published plan.

**Board** (Housekeeping → Reinigungsaufträge; Property Manager, Housekeeping Supervisor):
- Columns per housekeeper plus Unassigned, plus anyone still holding tasks who is no longer a Housekeeper here.
- Room chips dragged between columns, minutes against the shift.
- Inspection list, rules, minutes and rhythms per room type (prefilled), and Sections (Reviere) with each room's Section.

**Verified:**
- 369 tests green (db 171), plus typecheck and the tenant SQL lint.
- Browser walkthrough 3/3: tasks generated, published, failed inspection reopening the task.

**Review fixes applied:**
- Called-off tasks marked; the departure room is the one slept in; a vacated room is cleaned.
- Hooks for stay edits, undo, cancelled check-in; one sync per booking cancellation.
- Task step guards and today's published plan.
- Failed inspection returns the room to its cleaner; the reason is logged with the change.
- Room-wide moves; assignee checked at the task's own property; deterministic proposal keeping rooms together.
- Room type rules no longer wiped; waiting-guest priority; Sections on the board.
- Glossary: the extra clean added to Housekeeping Task; German labels.

**Open points:**
- A photo with a failed inspection waits for tenant file storage (ticket 36).
- The phone view, offline and languages: ticket 35. "Changed" reaches phones there.
- A failure inside the housekeeping sync now fails the writer's whole transaction (consistent, but a bug there would block check-ins and bookings).

