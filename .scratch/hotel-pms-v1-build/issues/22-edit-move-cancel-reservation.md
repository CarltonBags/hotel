# 22 — Edit, move and cancel reservations with audit log and forced overbooking

**What to build:** On a reservation tab, Front Desk changes dates, occupancy or room type in place: availability is re-checked for new nights, only changed nights are repriced at current rates, and every change is logged with who, when, before and after; the change history is visible on the record. Cancel per reservation or whole booking shows the Cancellation Policy fee for staff to confirm or waive later. Front Desk or Property Manager may force a reservation past availability after an explicit confirmation; such reservations are flagged on the dashboard. Room Assignment (date-ranged segments, a mid-stay move adds a segment) is set from the reservation tab.

**Blocked by:** 21 Create a reservation with availability and stored prices

**Status:** done

- [x] Extending by one night reprices only the added night
- [x] Every edit produces one audit entry with before and after values visible on the tab
- [x] Forced overbooking needs the confirmation dialog and shows on the dashboard flag list
- [x] A room move mid-stay creates a second Room Assignment segment on the same reservation

## Comments

**Done (2026-10-02).** Tenant migration 0009: reservations get `overbooked`, cancellation time/user, `cancellation_fee` with status open/confirmed/waived; `reservation_changes` (one entry per change, before and after as JSON); `room_assignments` (date-ranged segments). Domain `reservation-edit.ts`: `nightsToReprice` (added nights, or every night when occupancy or room type changes), `nightsNeedingRoom` (Availability is checked only where a new room is needed), `cancellationFee` with `zonedInstant` (deadline in property time, correct on daylight-saving days), `splitAssignment`. DB `reservation-changes.ts`: `updateReservation` (property lock, Rate Plan "date changes allowed", past dates refused, `OverbookingNeeded` unless forced, overbooked flag recomputed, assignments follow the stay), `cancelReservation` / `cancelBooking` with the policy fee, previews without locks, `setCancellationFeeStatus`, `assignRoom` / `moveRoom` / `unassignRooms`, `listFreeRooms`, `reservationHistory`, `listOverbooked`; `createBooking` takes a per-room force. Screens: reservation tab panels for change stay (with an overbooking confirmation dialog), Room Assignment and moves, cancel this reservation / whole booking (fee shown first), fee confirm/waive, readable change history; New reservation offers "Overbook…" on sold-out plans behind a confirmation dialog; Today lists overbooked reservations (dashboard flag list until ticket 25).

**Verified:** 203 tests green (domain 77, db 81, auth 17, staff 10, worker 14, events 4), typecheck, builds, tenant SQL lint. Browser walkthrough 9/9: extension reprices only the added night (100/100/100/130); one history entry with before and after; assign then mid-stay move gives two segments; sold-out type offers Overbook, the dialog flags the reservation and it appears on Today; cancel shows "free of charge" first and releases the rooms.

**Test runs:** packages share one test database and reset it, so the root `test` script and CI now run packages one after another (`--concurrency=1`, `--workspace-concurrency=1`); parallel runs failed intermittently.

**Review fixes applied:** availability checked only on nights needing a room (occupancy changes take none); overbooked flag cleared when the stay fits again; checked-in guests keep their room type and slept nights (moves only); departures cannot move into the past; child-age order no longer counts as a change; DST-correct fee deadline; whole-booking cancel locks before choosing and previews the summed fee; lost room assignments appear in the history; fee entries hidden from users without folio rights; typed `OverbookingNeeded`; Rate Plan "date changes allowed" enforced.

**Open points:**
- Restrictions (minimum stay, closed to arrival, stop sell) do not apply to staff edits; they steer selling. Confirm with the owner.
- "Today" is the property's wall-clock date until Night Audit provides the Business Date (TODO in code).
- Confirmed cancellation fees are posted by the folio tickets (26/29).
- Edit on the edit screen with forced overbooking is covered by db tests; the browser walkthrough forces on a new booking.
