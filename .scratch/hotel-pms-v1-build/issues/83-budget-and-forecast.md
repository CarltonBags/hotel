# 83 — Budget and forecast

**What to build:** Property Manager or Revenue enters a Budget per property and month for occupancy, Average Daily Rate, Net Room Revenue and total revenue, or imports it from a spreadsheet; the system spreads monthly values over days by last year's weekday pattern; one budget per year plus one revised forecast; reports compare against Budget.

**Blocked by:** 82 Fixed reports with comparisons, export and scheduling

**Status:** in review (PR stacked on ticket 45)

- [x] Monthly budget spreads to days summing back to the month
- [x] Revenue report shows actual against Budget and forecast
- [x] Spreadsheet import validates months and figures

## Comments

**Built**
- `/budget` (Main Menu → Reports):
  - The Budget and a revised Forecast per property, year and month: occupancy %, Average Daily Rate, Net Room Revenue and total revenue.
  - Property Manager and Revenue enter it; Accounting sees it read only. An emptied month is cleared.
  - Spreadsheet import (CSV): semicolon files with decimal comma and thousands point, or comma files with decimal point. Every bad line is named (first ten); nothing is saved until all lines are right. Non-text files are refused.
- Spreading: room nights are occupancy × the month's Available Rooms. Room nights, Net Room Revenue and total revenue follow last year's weekday pattern (by Net Room Revenue, or room nights where it had none) times each day's Available Rooms, and add back up to the month exactly. A day without rooms gets nothing.
- Occupancy and revenue report: Budget and Forecast columns per period, per property and in total.
  - Occupancy, Average Daily Rate (as entered, weighted by room nights), Net Room Revenue and total revenue.
  - A variance column: actual Net Room Revenue against the plan, in %.
- Glossary: Forecast added; the Budget entry's _Avoid_ line updated.

**Verified**
- Domain tests: the spread sums to the month, weekend weighting, no history, days without rooms, German thousands, import errors by line.
- DB test: Budget and Forecast set and validated; the report's total and weeks add up to the month's figures.
- All packages typecheck and pass.
- Walkthrough (4/4): Budget entered by month; bad import refused with its lines; good import saved; report shows actual against Budget and Forecast, weeks adding up to the month.

**Review fixes**
- Budget columns are no longer shown for a single room type, where they would have shown the whole property against one type's rooms; a note says so.
- Rows are matched by a reference, not by their label: equal or "Total"-like property names cannot take the wrong figures.
- The spread respects each day's Available Rooms, and the cent rounding no longer goes negative.
- Two night queries per report instead of two per month and version.
- The entered Average Daily Rate is what the report shows.
- Accounting may view the Budget.
- Thousands points in semicolon files are read correctly, and the separator is taken from the first line.
- Months can be cleared.

**Open points**
- Only Occupancy and revenue compares with the Budget: it carries the Budget's four figures. The other reports have no Budget figures to compare.
- The spread uses this year's Available Rooms, read live: the planned occupancy follows room changes and Out of Order blocks.
- Import is CSV; a native .xlsx import is not built.
- Nothing checks that the entered Average Daily Rate fits Net Room Revenue ÷ (occupancy × Available Rooms); both are shown as entered.
