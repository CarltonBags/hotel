# 19 — Rates grid tools: paste, copy period, fill to horizon, Event Markers

**What to build:** In the grid, Revenue pastes a block from a spreadsheet starting at the focused cell with a preview, copies prices and restrictions from one date range to another aligned by weekday, fills prices to the 500-day horizon by repeating the last full week or by base price with weekend factor, and names Event Markers (fair, holiday, concert) that appear in the grid header, in the bulk range picker and later in the Calendar.

**Blocked by:** 18 Rates grid with keyboard entry and bulk edit

**Status:** in review (pull request on branch ticket-19-rates-grid-tools, stacked on ticket-35-housekeeper-phone)

- [x] Paste of a 7 by 5 block lands on the right cells and is undoable
- [x] Copy period aligned by weekday verified across a month boundary
- [x] Fill to horizon removes the horizon banner
- [x] Event Markers stored per property with date range and name

## Comments

**Built (2026-10-04).** Rates grid tools from the "Tools in v1" decision.

**Paste.**
- Cmd/Ctrl+V in the grid reads a block copied from a spreadsheet (tab or semicolon separated) and places it from the focused cell: row by row down the grid, day by day to the right.
- Decimal commas and thousands separators are read. An ambiguous "1,234" or "1.234" is refused, not guessed.
- The landing area is highlighted, and a preview shows the cells and rows that change, values left out (derived rows follow their base, cells below the last row) and prices below the floor. Apply writes it, and Undo reverts it.

**Copy period.**
- Copies prices (base rows) and the restrictions stored on each row from one range to another of the same length, aligned by weekday: each target day takes the same weekday from the matching week of the source.
- It works across month boundaries and when the target overlaps the source (values are read from before the copy).
- A derived row keeps its inherited restriction fields with its base.
- Rows: the grid selection, or all rows.

**Fill to the horizon.**
- Fills to the Business Date + 500 days, for every row whose prices end earlier, or for those in the selection.
- Either repeats the last seven priced days by weekday, or uses a base price with a weekend factor for Friday and Saturday nights.
- Rows without a full last week are named and left out.

**Common to all three tools.**
- Each is previewed on the server and applied as one change planned inside the property lock, refused if the prices changed since the preview, and undoable.
- Bounds: between the Business Date and the horizon; paste up to 200 rows by 400 days; copy up to 400 days.

**Event Markers.**
- Named dates or ranges per property (up to a year).
- Shown in the grid header with the name on the first day, picked in the bulk panel to select their dates, and shaded in the Calendar header.
- Added and removed under Tools.

**Also:** the grid's "today" (highlight, below-floor list, horizon) is now the Business Date.

**Verified:**
- 389 tests green (domain 152, db 181), plus typecheck and the tenant SQL lint.
- Browser walkthrough 9/9:
  - a 7 by 5 paste previewed (14 cells, 21 left out), landed and was undone
  - a copy from Friday 30 Oct landed on Friday 27 Nov
  - fill removed the horizon banner
  - an Event Marker shows in the grid header (3 days) and the Calendar

**Review fixes applied:**
- Overlapping copy no longer drops days.
- Inherited restrictions are not copied onto derived rows.
- Fill respects the selection and names the rows it leaves out.
- The paste target is highlighted.
- Inactive plans are not filled.
- Ambiguous thousands separators are refused.
- Server-side bounds on every tool's input and dates.
- Marker length checked in code.
- Marker picking keeps the selected rows and forgets a marker that never came into view.
- Marker colour in one place.
- Docs corrected (the preview is planned on the server).

**Open points:**
- Weekend for the fill factor is Friday and Saturday nights (hotel pricing), while the grid shades Saturday and Sunday columns; confirm with the owner.
- A marker longer than the 28 days shown selects the days in view (a hint says so).
- Stale detection compares the cell count, as bulk edit does.
- Server messages are English only, as elsewhere.

