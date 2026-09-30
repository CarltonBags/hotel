# 18 — Rates grid with keyboard entry and bulk edit

**What to build:** Revenue and Property Manager edit prices and restrictions in the spreadsheet grid from the prototype: rows rate plan by room type grouped under the plan, derived rows read-only with "follows" text, columns dates with weekday, weekend shading and the open Business Date highlighted; cells show price and restriction marks. Keyboard: arrows move, digits start editing, Enter saves down, Tab saves right, Esc cancels, Shift-arrows or drag select a rectangle. Bulk edit panel with weekdays, set or adjust price, one restriction, and a preview (cells, price range, derived rows, cells below Price Floor, min stay above max stay) before Apply. Saved at once; Undo for 10 minutes; change log with user, old and new value; below-floor cells red and listed for the Property Manager; banner when prices run out inside the horizon.

**Blocked by:** 17 Rate Plans, policies, Supplements and Restrictions

**Status:** ready-for-agent

- [ ] Grid matches docs/design/rates variant A
- [ ] Bulk edit preview counts equal the cells changed after Apply
- [ ] Undo within 10 minutes restores every cell of the last change
- [ ] Prices below Price Floor save with a warning and appear in the list
