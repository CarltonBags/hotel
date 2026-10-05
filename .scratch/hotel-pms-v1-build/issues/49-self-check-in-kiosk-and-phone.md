# 49 — Self Check-in on kiosk and phone

**What to build:** One cinematic flow in the guest app, on a lobby kiosk (enrolled Device) and on the guest's phone from the Portal Link: find booking (QR or number plus name; phone skips), Check-in Conditions tested at once (arrival day and earliest time, inspected room of the type available, registration by a legal path, balance paid or card guaranteed), confirm stay, details and registration (Austria signature on screen; Germany foreign guest only by the card path of ticket 46 else hand-over; Swiss per Canton Profile), payment, room and key. All conditions met: room assigned, Checked-in, charges posted, room number shown, no staff action. Room not ready: guest finishes and becomes Arrived, Waiting for Room with a priority flag; staff tell the guest when assigned. Any other failure: "Reception will help you", data kept, desk alerted with reason. Phone: Checked-in only on the arrival day in check-in hours after "I am at the hotel" or scanning the lobby QR. Key step follows the property's key handover setting; "collect at reception" until ticket 69. Front desk sees a live line, completion notice and help alerts.

**Blocked by:** 45 Meldeschein registration on the tablet, 41 Portal payments, card storage and express checkout, 33 Room state, Room Blocks and the room picker

**Status:** in review (PR stacked on ticket 47)

- [x] Matches docs/design/self-checkin variant A on kiosk and phone
- [x] All conditions met: reservation becomes Checked-in without staff and charges are posted
- [x] Room not ready: guest ends as Arrived, Waiting for Room and the room type shows the priority flag
- [x] Kiosk keeps no guest data after the flow and shows only "come to reception" when offline

> Note from ticket 47: Self Check-in must hand over to reception while the registration needs a handwritten signature (Germany; Swiss Canton Profiles with the handwritten default). The rule is `registrationAtReception(country, profile)` in the domain package; the Guest Portal already uses it.

## Comments

**Built.** One flow in variant A "Cinematic glass" on a lobby kiosk (`/kiosk`, a guest Device enrolled as kiosk) and on the phone (`/g/<key>/checkin`, linked from the Portal on the arrival day): find the booking (number and last name, or the confirmation's QR; phone skips), confirm the stay, registration on screen, payment or a card left as guarantee (Stripe's own form, 3-D Secure in place), result. Check-in Conditions tested at once (arrival day from the check-in time, registration by a legal path, balance paid or card guaranteed, a ready room of the type). All met: a ready room (the assigned one, else a free ready room of the type) is assigned and the stay Checked-in by "self-checkin" with Charges posted. Only the room not ready: Arrived, Waiting for Room, the room nearest to ready planned so its arrival preparation is the priority on the board. Anything else: "Reception will help you", data kept, desk told why. Registration on screen only where the guest's own form is the only one and the signature is on screen (Austria; Swiss cantons with the tablet signature); everyone staying is declared; Germany (until ticket 46), handwritten cantons, ID-Check-only cantons and further forms go to reception. Key step: "collect at reception" (key handover setting) until ticket 69. Desk: live line on Today (step, then outcome and reason), notifications for help, waiting, and completion (in-app; full when the ID Check is still open). Lobby QR on Settings → Devices. Kiosk keeps nothing: memory only, forgotten after the result, two idle minutes (ten while paying) and offline, which shows only "come to reception".

**Verified.** db tests (6): kiosk lookup only today's arrivals by number and name; Austrian on-screen registration and check-in with charges and a ready room; room not ready → waiting with a priority task; assigned dirty room gives way to a ready one; everyone declared and a second adult's form → help; balance due → help and the live line. Walkthrough 24/24 (Berlin temporarily Austrian): kiosk enrol option and lobby QR, find, live line, signed on screen, room shown, Checked-in and charges, kiosk forgets, waiting with priority, offline screen, portal link, phone "I am at the hotel", declared companions, help with reason, notification.

**Review fixes.** Property lock taken before the reservation row (lock order); a free ready room wins over an assigned one not ready, an assigned room Out of Order is not used; a check-in refused meanwhile ends at reception (savepoint) instead of an error; only our own guest words reach the guest; the result shows the reasons the server gives; kiosk scope enforced on every call; card guarantee offered beside paying; idle longer while paying; the scanner keeps reading after a wrong code; notifications in plain words, full when the ID Check is open; lobby URL through `tenantUrl`; glossary (Device, Check-in Conditions).

**Open points.**
- The ID Check of a registration signed on screen stays with the desk (notified); legal confirmation that check-in may precede it in Austria and the tablet-signature cantons.
- "I am at the hotel" is the guest's word, as the spec allows; the lobby QR only skips the question. A stricter rule (QR only, or the property's network) would be a product decision.
- Check-in hours end with the day; no closing time is configured.
- Opening `/kiosk` while offline shows the browser's page (no service worker yet).
- The completion notice shows guest and room, not the amount paid or how the guest registered.
