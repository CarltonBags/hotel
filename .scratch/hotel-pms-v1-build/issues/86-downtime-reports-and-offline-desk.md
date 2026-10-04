# 86 — Downtime Reports, offline desk and Catch-up Entry

**What to build:** One button prints the Downtime Reports set (arrivals, expected departures, in-house, Room Rack grouped by floor with vacant rooms, blank registration forms) with date, time and user in the footer, each list also alone, contents and sort configurable, optional shift-start reminder. The staff app keeps the latest lists on each enrolled front desk device and, when the connection drops, shows them read-only with their age under a permanent banner with changes disabled and explained; an emergency report with open Card Holds and emergency contacts is saved encrypted to those devices every 2 hours and after the audit, optionally emailed or printed. Kiosk and tablet show only "come to reception". Afterwards staff make Catch-up Entries (check-in, check-out, payment, room move) with the real time, marked as entered after an outage, in the Business Date that was open; outage start and end are logged per property. When the cause is ours the status page says so and Property Managers get email and SMS.

**Blocked by:** 25 Today dashboard, operational lists and cross-property search, 32 Night Audit and Business Date, 14 Devices and PIN Sign-in

**Status:** in review (PR stacked on ticket 82)

- [x] Downtime set prints as one job with footers
- [x] Cut the connection: lists remain readable with age, all mutations disabled
- [x] Catch-up Entry stores real time and entry time and lands in the right Business Date
- [x] Emergency report on the device decrypts only for a signed-in user and old copies are deleted

## Comments

**Built**
- Downtime Reports (`/downtime`, Main Menu → Lists):
  - Arrivals, expected departures, in-house, and the Room Rack: every room by floor, vacant ones included, with type, Cleanliness, block, occupant with persons and departure, and next arrival.
  - Blank registration forms.
  - One print job, or each list alone. Date, time and user are in a footer on every printed page.
  - Per property (Property Manager): balance, booking notes and Housekeeping Notes on or off; order by room or surname; number of blank forms; shift-start reminder time. The reminder shows until the set is printed that day.
- Offline desk, for desk users with one property in scope:
  - The browser keeps the latest lists plus the emergency report (how to reach every guest in house, open Card Holds). Renewed every 15 minutes, so soon after the Night Audit too.
  - The copy is AES-GCM encrypted with a key derived per sign-in session and held only in memory. One copy, overwritten each time, wiped on sign-out and when the server says signed out.
  - Heartbeat every 20 s plus the browser's offline signal. When the service stops answering, a cover with the time lost and the lists' age shows the lists read only; everything underneath is inert.
  - Back online, the desk logs the outage for the property.
- Catch-up Entry (`/catch-up`):
  - Outages logged per property: start, end, cause, note.
  - Check-ins, check-outs, payments (cash or bank transfer only: no card offline) and room moves are entered with the time they really happened. The time must lie inside a logged outage and in the Business Date still open.
  - The record keeps `real_at` beside its entry time: the stay's check-in or check-out time, and the payment's.
- A major incident reported on the status page alerts every customer's Property Managers: in-app notification and queued email, sent by a worker job, each incident once.

**Verified**
- Domain tests: options, sort, reminder, list age, catch-up rules.
- DB tests: the set and Room Rack, emergency contacts, catch-up times and Business Date, other-property refusal, refusal after the day closed.
- Worker test: a major incident alerts Property Managers once; minor ones nobody.
- All packages typecheck and pass; tenant SQL check clean.
- Walkthrough (9/9): set with every list, all rooms and the footer; prints as one job; single list; shift reminder; encrypted copy kept; offline cover with age, inert; back online the cover goes; check-in entered with its real time in the open Business Date.

**Review fixes**
- A catch-up for a reservation of another property is refused (it was possible).
- Catch-up needs the desk's own rights (check-in, take payments), not view rights.
- The key is per session, no longer per user forever.
- The copy is wiped on sign-out, and the snapshot answers 401 instead of redirecting.
- The cover makes the page inert; the first heartbeat runs on load.
- Outage alerts moved from the server action into the worker, once per incident, a failing tenant isolated.
- The reminder's printed-day uses the property's date.
- The desk logs outages itself; the stay picker includes today's check-outs.

**Open points**
- The copy serves the open app. A desk restarted during an outage has no key and no app (no offline shell); the printed Downtime Reports cover that.
- Not built:
  - Emailing or printing the emergency report after the Night Audit.
  - SMS to Property Managers (no provider).
  - The kiosk and tablet "come to reception" screens (tickets 45 and 49).
  - A Quick Access button for printing.
- Catch-up runs the action, then writes `real_at` in a second transaction. If the second fails, the record stays unmarked; making it one transaction needs the actions to accept a transaction.
- An entry whose real time lies before the last Night Audit close is refused rather than placed in a closed day.
- The Room Rack's next arrival shows the date only: arrival times are not recorded yet.
- "Emergency contacts" are the guests' own phone and email; there is no separate emergency contact field on the guest.
- The emergency report carries guests' phone and email to every desk browser of the property (encrypted). Worth an ADR on data minimisation.
