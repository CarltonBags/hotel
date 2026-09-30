# 33 — Room state, Room Blocks and the room picker

**What to build:** Rooms carry Cleanliness (Dirty, Clean, Inspected), derived Occupancy and dated Room Blocks (ADR 0011). Out of Order removes the room from sale for its range (availability drops, channel update queued later, conflict warning on assigned reservations); Out of Service keeps it sellable but flagged. Automatic Dirty at check-out, on room move, when a block ends and at audit close. Inspection setting per property, default on. The room picker shows cleanliness with expected ready time, blocks and open issues, Room Features matched against guest preferences, and the next reservation in the room. Check-in into a room that is not ready warns and needs a reason; assignment into an Out of Order range is refused. Per-role rights as in the matrix (Front Desk may set Clean and Inspected).

**Blocked by:** 28 Invoices with gap-free numbering, ZUGFeRD PDF, Deposit Invoice and check-out

**Status:** ready-for-agent

- [ ] Out of Order on 2 of 10 rooms of a type lowers availability to 8 for those nights
- [ ] Check-out sets Dirty; a non-ready check-in is logged with reason
- [ ] Room picker sorts rooms matching the guest's preferences first
- [ ] Housekeeper role can only see and set its own rooms via API
