# 84 — Report builder and raw data export

**What to build:** A user picks one data set (room nights, reservations, charges, payments, housekeeping tasks), columns, filters, grouping and totals and gets a table; saved reports private or shared with the property; columns follow the role's rights; every export of guest-level data is logged with user and row count. Raw data export of reservations, charges and payments for a date range as spreadsheet files.

**Blocked by:** 82 Fixed reports with comparisons, export and scheduling

**Status:** in review (PR stacked on ticket 83)

- [x] Revenue role cannot add contact columns
- [x] Export of guest rows is logged with count
- [x] Saved shared report visible to colleagues at the property only

## Comments

**Built**
- Report builder (`/reports/builder`), for Property Manager, Accounting and Revenue:
  - One data set: room nights, reservations, charges, payments or housekeeping tasks.
  - Columns, up to three filters (is, is not, contains), two groupings (text columns, shown), and totals over everything that matched. A table; at most 5,000 lines on screen.
- Columns follow the role's rights at every property in scope:
  - guest names need view guests; contacts need view guest contacts;
  - revenue figures (night price, stay total, charge net and gross) need the revenue reports right, so Revenue may build them;
  - money movements (the payments data set) need the financial reports right.
  - A crafted query asking for more is refused.
- Saved reports, private or shared with one property. A shared report shows only to colleagues at that property who may see every column and filter in it, and opens at its own property. Only the owner deletes.
- Export of a table as spreadsheet or PDF.
- Raw data export: reservations, charges and payments for a date range, every column the user may see, as spreadsheet file, up to 100,000 lines.
- Every export is logged with user, data set, properties, format and lines (the totals line not counted).

**Verified**
- Domain tests: Revenue without contact columns but with revenue figures; Front Desk and Housekeeping Supervisor without the builder; Accounting with contacts; grouping rules.
- DB tests: grouped charges with totals; status filter; `contains` taken literally; saved reports private, shared by property, owner-only delete.
- All packages typecheck and pass.
- Walkthrough (3/3): Revenue offered no contact columns and refused a crafted query and its export (403); guest rows exported with the logged line count, raw export logged; a shared Berlin report visible to a Berlin colleague, not to a Zürich-only one.

**Review fixes**
- The builder was open to Front Desk and Housekeeping Supervisor; it is now restricted to its three roles (`use_report_builder`).
- Revenue was blocked from every revenue figure; revenue figures now have their own right.
- Grouping by a column not shown broke the query; it is now refused.
- Grouped queries had no line cap; they now share the line cap.
- Totals covered only the lines shown; they now cover all matches.
- Database errors are no longer echoed to the browser.
- Shared reports whose filters show data a colleague may not see are not listed to that colleague.
- The export log no longer counts the totals line.
- Support sessions cannot save or delete reports.

**Open points**
- The raw export stops at 100,000 lines, noted in the file. A streamed export for larger ranges would need a worker job.
- Country of residence is treated as plain (statistical) data, not guest-level.
- No native .xlsx: spreadsheet files are CSV, as for the fixed reports.
