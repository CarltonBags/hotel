# 18 — Rates grid with keyboard entry and bulk edit

**What to build:** Revenue and Property Manager edit prices and restrictions in the spreadsheet grid from the prototype: rows rate plan by room type grouped under the plan, derived rows read-only with "follows" text, columns dates with weekday, weekend shading and the open Business Date highlighted; cells show price and restriction marks. Keyboard: arrows move, digits start editing, Enter saves down, Tab saves right, Esc cancels, Shift-arrows or drag select a rectangle. Bulk edit panel with weekdays, set or adjust price, one restriction, and a preview (cells, price range, derived rows, cells below Price Floor, min stay above max stay) before Apply. Saved at once; Undo for 10 minutes; change log with user, old and new value; below-floor cells red and listed for the Property Manager; banner when prices run out inside the horizon.

**Blocked by:** 17 Rate Plans, policies, Supplements and Restrictions

**Status:** done

- [x] Grid matches docs/design/rates variant A
- [x] Bulk edit preview counts equal the cells changed after Apply
- [x] Undo within 10 minutes restores every cell of the last change
- [x] Prices below Price Floor save with a warning and appear in the list

## Comments

**Done (2026-10-01).** Rates grid at `/rates` (module "Rates", right `manage_rates`), built from prototype variant A: rows rate plan by room type grouped under the plan, derived rows greyed and read-only with "follows … − 10 %", date header with weekday, weekend shading and today highlighted, cells with price, restriction marks and stop-sell hatching, row label with Price Floor. Keyboard: arrows, digit starts editing, Enter/double-click edits the existing value, Enter saves down, Tab right, Shift+Tab left, Esc cancels, Shift+arrows, shift-click or drag selects a rectangle, row label selects the row, Cmd/Ctrl+Z undoes. Bulk panel with weekdays, keep/set/± amount/± %, one restriction, preview (cells and rows, price range, derived rows following, selected derived rows changed through their base, below floor, min stay above max stay, below zero) and "Apply to n cells". Below-floor prices red with a warning and listed; horizon banner (500 days); change log with time in the property's zone, user, old and new value.

Domain `rates-grid.ts`: `planBulkEdit` is the one planner for the browser preview and for Apply. DB: `applyGridEdit` (typed price), `applyBulkEdit` (plans and writes inside the property lock; refused when the cell count differs from the preview), `undoLastChange` (the user's last grid change within 10 minutes, every cell incl. followers and restrictions; refused when anyone changed those cells since), `listBelowFloor`, `listPriceEnds`. Migration 0006: `rate_changes.undone_by`, `at` defaults to `clock_timestamp()` so times follow the order of writes under the lock.

**Verified:** 157 tests green (domain 54, db 58, auth 17, staff 10, worker 14, events 4), typecheck, builds, tenant SQL lint. Browser walkthrough 16/16: typed price and derived follower, below-floor warning naming base and follower, list, Esc, double-click, Shift+arrows 2×3, row selection, derived-row hint, bulk preview 7 cells = 7 cells in the change log after Apply, 2N marks, undo restores prices and restrictions, change log.

**Review fixes applied:** undo reverts only grid edits (not settings saves); change times from `clock_timestamp()`; bulk planned inside the locked transaction; empty bulk value no longer sets 0; keyboard focus returns to the grid after saving; one save per edit; stable time formatting; invalid `?from=` falls back to the default; follower rows below floor warned on typed prices; no extra index on the log table (feasibility constraint 11); shared `propertyFor` and `cellKey`; restriction-only edits count their rows; derived-selected counts only rows whose base changed.

**Open points:**
- Business Date: the property's local today stands in until Night Audit exists.
- Channel sync state shows "Channel manager not connected yet"; the outbox ticket replaces it.
- Undo is per user (your own last change), which reads the decision "Undo reverts the last change" for a shared screen; confirm with the owner.
- The below-floor list is visible to everyone who edits rates, not only the Property Manager.
- Server messages (warnings) are English only; grid labels are translated.
