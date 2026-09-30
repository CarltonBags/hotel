# 49 — Self Check-in on kiosk and phone

**What to build:** One cinematic flow in the guest app, on a lobby kiosk (enrolled Device) and on the guest's phone from the Portal Link: find booking (QR or number plus name; phone skips), Check-in Conditions tested at once (arrival day and earliest time, inspected room of the type available, registration by a legal path, balance paid or card guaranteed), confirm stay, details and registration (Austria signature on screen; Germany foreign guest only by the card path of ticket 46 else hand-over; Swiss per Canton Profile), payment, room and key. All conditions met: room assigned, Checked-in, charges posted, room number shown, no staff action. Room not ready: guest finishes and becomes Arrived, Waiting for Room with a priority flag; staff tell the guest when assigned. Any other failure: "Reception will help you", data kept, desk alerted with reason. Phone: Checked-in only on the arrival day in check-in hours after "I am at the hotel" or scanning the lobby QR. Key step follows the property's key handover setting; "collect at reception" until ticket 69. Front desk sees a live line, completion notice and help alerts.

**Blocked by:** 45 Meldeschein registration on the tablet, 41 Portal payments, card storage and express checkout, 33 Room state, Room Blocks and the room picker

**Status:** ready-for-agent

- [ ] Matches docs/design/self-checkin variant A on kiosk and phone
- [ ] All conditions met: reservation becomes Checked-in without staff and charges are posted
- [ ] Room not ready: guest ends as Arrived, Waiting for Room and the room type shows the priority flag
- [ ] Kiosk keeps no guest data after the flow and shows only "come to reception" when offline
