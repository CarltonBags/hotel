# Self check-in guest interface

Map: ../map.md
Type: prototype
Status: resolved
Blocked by: 07

## Question

Context from "Guest portal identity model": remote online pre-check-in is always staff-approved and staff assign the room; digital key is a per-property opt-in. This ticket decides whether the lobby kiosk may complete check-in without staff (e.g. when a clean room is already assigned and payment is guaranteed) and what it shows otherwise.

What does the Apple-like self check-in interface look like and do? Prototype the guest flow: find reservation, confirm details, complete registration (including Meldeschein where required), pay balance, receive room and key instructions. Decide whether it runs on a lobby kiosk, on the guest's phone via the portal, or both, and what the staff sees when a self check-in completes.

## Answer

Resolved 2026-09-28 by prototype; verdict given by the product owner in the browser.

**Look: variant A, "Cinematic glass".** Full-bleed landscape wallpaper (property can set its own photo), one dark glass card, one question per screen, progress as dots, very large room number on the final screen. Variants B (light checkout with summary) and C (concierge conversation) were not chosen.

**Surfaces**: one responsive flow in the guest app, used on a lobby kiosk (an enrolled Device) and on the guest's phone (opened from the Portal Link). The kiosk starts with "find your booking" (scan the confirmation's QR code, or confirmation number plus last name); the phone skips it.

**Steps**: find booking, check-in conditions, confirm stay, details and registration, payment, room and key.

**Check-in Conditions**, configurable per property, are checked **right after the booking is found**, before the guest does anything else:
1. arrival day reached and the earliest self check-in time passed;
2. an inspected room of the booked room type is available;
3. registration complete by a path that is legal for the property's country;
4. balance paid or card guaranteed.
Conditions 1 and 2 are known at the start, so the guest is told immediately if the room is not ready and may still complete registration and payment.

**Autonomous completion**: when all conditions hold, the system assigns a room, sets the reservation to Checked-in, posts the charges and shows the room number. No staff action.

**Room not ready or too early**: the guest finishes registration and payment and is marked **Arrived, waiting for room**. Front desk and housekeeping see it and the room type gets a priority flag. When an inspected room is assigned the guest is notified by email or SMS with room number and key instructions.

**Any other failure** (payment declined, registration needs paper, ID problem): screen "Reception will help you", everything entered is kept, front desk gets an alert with the reason and a link to the reservation.

**Phone rule**: registration and payment may be done any time (that is Pre-check-in). Becoming Checked-in with a room number happens only on the arrival day within check-in hours **and** after the guest proves presence by tapping "I am at the hotel" or scanning a lobby QR code. This replaces "online pre-check-in is always staff-approved" from "Guest portal identity model" for guests who are on site; remote pre-check-in itself still never checks anyone in.

**Key handover** is a per-property setting: collect at reception (default, no hardware), kiosk key-card encoder, Digital Key, or door PIN. The final screen follows the setting. Vendors stay in fog.

**Front desk** sees a live line while a guest is in the flow, a completion notice (guest, room, amount paid, key mode, how registration was confirmed) or a help alert.

**Registration inside self check-in** reuses the paths from "Meldeschein tablet signing flow", constrained by "Arrival-day card transaction for registration":
- Austria: signature on screen.
- Germany, foreign guest: the card path works only with a fresh card transaction with strong customer authentication on the arrival day, triggered by the guest as cardholder. If the stay is prepaid, paid by a company or paid without proven authentication, self check-in cannot complete the registration and hands over to reception for the printed form.
- Germany, German national: no registration step.

Assets:
- Screenshots: `docs/design/self-checkin/` (winner files marked WINNER).
- Prototype: `apps/staff-shell-prototype`, route `/prototype/checkin?variant=A|B|C`, params `device=phone`, `demo=<step>`, `key=<mode>`, `blocker=<reason>`. Code in `components/prototype/checkin/`. Uncommitted.
- Known prototype gap: it checks conditions at the end, not at the start; the decision above is the rule.

> Update 2026-09-29 from "Door lock systems and their integration": a kiosk that hands out key cards needs a network encoder assigned to that kiosk Device; kiosk card dispensers with a built-in encoder were not verified. Key handover by encoder at a kiosk therefore depends on "Digital key and key card handling".

> Update 2026-09-29 from "Notifications model": no automatic room-ready notice in v1. A guest who is Arrived, Waiting for Room is told by staff when the room is assigned. The earlier sentence about notification by email or SMS no longer holds.
