# Front desk without internet

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: -

## Question

What can the front desk do when the connection to the service is lost? Decide the promise: read-only lists kept on the device (arrivals, in-house, departures, room status) and how fresh they are; whether check-in, check-out and payments can be queued; what happens to card terminals, fiscal signing and door keys during the loss; the emergency report that is printed or saved every night; how queued actions are replayed and conflicts resolved; how staff are told. The floor staff phone view already works offline for the day's tasks.

## Answer

Resolved 2026-09-29 by grilling.

**Promise**: when the connection is lost, whether the hotel's line or our service, the front desk can read but not change.
- The staff app keeps the latest arrivals, in-house guests, departures and room status on the device and shows them with their age.
- No changes are possible offline. Two desks assigning the same room while blind is the risk this avoids.
- Work continues on paper and is entered afterwards.

**Downtime Reports** (raised by the owner): a set of printable lists staff can print at any time, for example at the start of a shift.
- Lists: arrivals, expected departures, in-house, **Room Rack**. Blank registration forms belong to the set.
- One button prints the whole set, from the Main Menu and as an optional Quick Access button. Each list can also be printed alone.
- Footer on every page: date, time and user.
- The property chooses what each list shows (balance, notes, Housekeeping Notes) and the sort order. An optional reminder appears at shift start.

**Room Rack**: every room on one line, grouped by floor: room, room type, Cleanliness, Room Block, guest surname and number of guests if occupied, departure date, next arrival with name and time. Vacant rooms are included, so staff can sell and assign on paper.

**Emergency report**: the same content, saved automatically to each enrolled front desk device every 2 hours while online and after the Night Audit, also listing open Card Holds and emergency contacts. Optionally emailed to one address or printed after the Night Audit. It contains personal data: encrypted on the device, old copies deleted.

**Payments while offline**: none in the product. No receipt can be signed and no card charged without a connection. The guest pays later (a stored card is charged when back online), or the hotel takes cash against a handwritten receipt and enters it afterwards under the outage rules. Whether card terminals can take payments on their own while offline is unverified and added to the outlet payments research.

**Catch-up entry**: after the outage staff enter check-ins, check-outs, payments and room moves with the time they really happened. The record keeps the real time and the entry time and is marked as entered after an outage. It belongs to the Business Date that was open. Start and end of each outage are logged per property.

**Guest-facing devices**: kiosk and registration tablet show "please come to reception" and nothing else. No guest data is kept on them.

**Noticing**: a permanent banner in the staff app while offline, with the time the connection was lost and the age of the lists; changes are disabled with an explanation. If the cause is on our side, a public status page says so and Property Managers are notified by email and SMS.

**Recommendation to hotels**, part of onboarding: a second internet line.

**Not covered here**: floor staff phones work offline for the day's tasks (phone view ticket); the point of sale's behaviour offline (point-of-sale ticket); door keys during an outage (digital key ticket).
