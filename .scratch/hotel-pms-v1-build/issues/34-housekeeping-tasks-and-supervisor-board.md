# 34 — Housekeeping Tasks, Sections and the supervisor board

**What to build:** After the Night Audit the system generates Housekeeping Tasks (departure clean, stayover clean, arrival preparation, linen change) with minutes per room type, following the property's stayover and linen rhythms (optionally per room type); early departures, room moves and new arrivals update tasks during the day; waiting guests give priority. The Housekeeping Supervisor sees the desktop board: one column per housekeeper plus Unassigned, rooms as chips dragged between columns, minutes against shift length, the morning proposal balanced by Section as a draft until Publish; a started task cannot be moved without confirmation. Inspection: rooms set to Clean are listed; Inspected in one tap or back to Dirty with reason and photo.

**Blocked by:** 32 Night Audit and Business Date, 33 Room state, Room Blocks and the room picker

**Status:** ready-for-agent

- [ ] Tasks generated for a demo day match the rhythm rules and the arrivals
- [ ] Publish makes the plan visible to housekeepers; changes after Publish are marked Changed
- [ ] Minutes per person sum correctly against the shift
- [ ] Inspection failure returns the room to the housekeeper's list
