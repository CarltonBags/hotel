# 19 — Rates grid tools: paste, copy period, fill to horizon, Event Markers

**What to build:** In the grid, Revenue pastes a block from a spreadsheet starting at the focused cell with a preview, copies prices and restrictions from one date range to another aligned by weekday, fills prices to the 500-day horizon by repeating the last full week or by base price with weekend factor, and names Event Markers (fair, holiday, concert) that appear in the grid header, in the bulk range picker and later in the Calendar.

**Blocked by:** 18 Rates grid with keyboard entry and bulk edit

**Status:** ready-for-agent

- [ ] Paste of a 7 by 5 block lands on the right cells and is undoable
- [ ] Copy period aligned by weekday verified across a month boundary
- [ ] Fill to horizon removes the horizon banner
- [ ] Event Markers stored per property with date range and name
