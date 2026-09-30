# Rates grid screen prototype

Map: ../map.md
Type: prototype
Status: resolved
Blocked by: -

## Question

What does the Rates grid look like and how does bulk editing feel? Prototype inside the chosen shell: rows as rate plan by room type (grouping and collapsing, derived plans shown as following their base), date columns with weekday and event markers, cells showing price and the six restriction marks, selecting a range by drag, the bulk edit panel (date range, weekdays, room types, set or adjust by amount or percentage, restrictions), preview of what will change before applying, the change log, the state of synchronisation to the channel manager, and warnings (price below floor, prices running out, minimum stay conflicts). Decide keyboard behaviour for cell-by-cell entry, since this is a data-entry screen.

## Answer

Resolved 2026-09-29 by prototype; verdict given by the product owner in the browser.

**Structure: variant A, "Spreadsheet grid".** Rows are rate plan by room type, grouped under the rate plan; columns are dates. Variants B (month calendar per rate) and C (price periods) were not chosen, and there is no second view.

**Grid**
- Header per date with weekday; weekends and Event Markers shaded; the open Business Date highlighted.
- Row label shows the room type and its Price Floor. Clicking it selects the whole row.
- Cell: the price, and beneath it the restriction marks: STOP, CTA, CTD, 2N (minimum stay on arrival), 2T (minimum stay through), ≤7 (maximum stay). Stop sell also hatches the cell. A date without a price shows a dash.
- Derived rate plans appear under their own heading with "follows Flexible − 12 %". Their cells are read-only and greyed; trying to edit one explains which base rate to change.

**Keyboard**, because this is a data-entry screen:
- click or arrow keys move the focus cell;
- typing a digit starts editing and replaces the value; Enter or double-click edits the existing value;
- Enter saves and moves down, Tab saves and moves right, Shift+Tab left, Esc cancels;
- Shift with arrow keys, or dragging, selects a rectangle for bulk edit.

**Bulk edit panel**, beside the grid:
- shows the selected date range and rows;
- weekdays to include;
- price: keep, set, change by amount, change by percentage;
- one restriction to set or remove;
- **a preview before anything changes**: number of cells and base rows, resulting price range, derived rows that follow, selected derived rows that are changed through their base, cells falling below the Price Floor, minimum stay longer than maximum stay;
- Apply names the number of cells.

**Saving**: at once. Typed prices and applied bulk edits are saved immediately and sent to the channels within about a minute. Undo reverts the last change for 10 minutes. The change log lists time, user, old and new value.

**Synchronisation state** is always visible in the screen header: "Sending n changes to channels" or "Channels up to date" with the time.

**Price below the Price Floor**: saved with a warning. The cell turns red, the bulk preview counts such cells, and the Property Manager has a list of prices below floor. The floor keeps protecting Price Overrides at the front desk.

**Prices running out**: a banner names the rate plans whose prices end inside the horizon and the date.

**Tools in v1**
- Paste from a spreadsheet, starting at the focused cell, with preview.
- Copy period: prices and restrictions from one date range to another, aligned by weekday.
- Fill prices to the horizon: repeat the last full week, or base price with weekend factor.
- **Event Markers**: the property names dates (fair, holiday, concert); shown in the grid header, in the Calendar and in the bulk range picker.

Assets:
- Screenshots: `docs/design/rates/`.
- Prototype: `apps/staff-shell-prototype`, route `/prototype/rates?variant=A|B|C`, param `demo=bulk`. Code in `components/prototype/rates/`. Uncommitted.
- Not prototyped, decided only: Undo, paste from spreadsheet, copy period, fill to horizon, naming Event Markers, the list of prices below floor.
