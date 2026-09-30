# 22 — Edit, move and cancel reservations with audit log and forced overbooking

**What to build:** On a reservation tab, Front Desk changes dates, occupancy or room type in place: availability is re-checked for new nights, only changed nights are repriced at current rates, and every change is logged with who, when, before and after; the change history is visible on the record. Cancel per reservation or whole booking shows the Cancellation Policy fee for staff to confirm or waive later. Front Desk or Property Manager may force a reservation past availability after an explicit confirmation; such reservations are flagged on the dashboard. Room Assignment (date-ranged segments, a mid-stay move adds a segment) is set from the reservation tab.

**Blocked by:** 21 Create a reservation with availability and stored prices

**Status:** ready-for-agent

- [ ] Extending by one night reprices only the added night
- [ ] Every edit produces one audit entry with before and after values visible on the tab
- [ ] Forced overbooking needs the confirmation dialog and shows on the dashboard flag list
- [ ] A room move mid-stay creates a second Room Assignment segment on the same reservation
