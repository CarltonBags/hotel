# 82 — Fixed reports with comparisons, export and scheduling

**What to build:** Property Manager, Accounting, Revenue and Housekeeping Supervisor open their reports as Workspace Tabs with date range, property and room type filters: occupancy and revenue (Occupancy, Average Daily Rate, Revenue per Available Room by day, week, month, room type), pickup and pace, source and channel mix, cancellations and no-shows, revenue by Service and Tax Code, housekeeping performance, receivables ageing, cash; definitions as decided (Available Rooms exclude Out of Order; Net Room Revenue by Service Date; fees in their own line). Comparisons with previous period and same period last year with weekdays aligned. Export as spreadsheet and PDF; schedule by email daily, weekly or monthly; consolidated across properties with per-property breakdown and conversion at a stated rate.

**Blocked by:** 32 Night Audit and Business Date, 50 Cash desk: Cash Registers, Shifts, Cash Book, Paid-outs and Receipts

**Status:** in review (PR stacked on ticket 87)

- [x] Occupancy for a demo month matches a hand calculation with two Out of Order rooms
- [x] Last-year comparison aligns weekdays
- [x] Scheduled weekly report arrives by email as PDF to a same-property user only
- [x] Consolidated report converts CHF to EUR at the stated rate

## Comments

**Built**
- Eight fixed reports, each its own Workspace Tab (`/reports/<kind>`, one Main Menu entry per report) with date range, the navbar's property scope, and a room type filter on occupancy, pickup, source mix and cancellations:
  - Occupancy and revenue: Available Rooms, occupied, Occupancy, Average Daily Rate, Revenue per Available Room, Net Room Revenue, fees in their own line, total revenue; per day, week or month, or by room type.
  - Pickup and pace: room nights and Net Room Revenue on the books per night, pickup since a chosen day, Occupancy on the books against the same time last year.
  - Source and channel mix: room nights, share, Net Room Revenue and Average Daily Rate per source and channel; direct share.
  - Cancellations and no-shows: counts, lost room nights, fees charged and waived, lead time.
  - Revenue by Service and Tax Code: net, VAT and gross per line and per tax rate.
  - Housekeeping performance: per person, by Business Date.
  - Receivables ageing: per Bill-to, by invoice date.
  - Cash: Cash Book per register, and Cash Differences per user by Business Date.
- Definitions as decided:
  - Available Rooms exclude Out of Order.
  - Net Room Revenue is by Service Date, without VAT, breakfast and other included Services, and City Tax. Corrections count with what they correct.
  - Stays not yet checked in count with their room component on the books.
  - Every report states its base.
- Comparisons with the previous period and last year (364 days back, weekdays aligned): per period on Occupancy, line by line on source mix, cancellations and revenue by code.
- Several properties: a line per property beside the consolidated figures. Other currencies are converted at the rate the user states on the report; the report is refused until every rate is stated.
- Export as spreadsheet (plain numbers, text neutralised) and as landscape PDF. Every export, mailed ones included, is logged with user, report, properties and row count (`report_exports`).
- Scheduling, daily, weekly or monthly:
  - For one's own address only, never during a Support Access.
  - The hourly worker job sends due schedules and re-checks the right at every property. A schedule whose user lost the right stops, with the reason shown.
  - The PDF is queued in the tenant's `mail_outbox`. Sending comes with ticket 39.

**Verified**
- Domain tests: figures, periods, the 364-day alignment, conversion, schedule timing.
- DB tests:
  - Occupancy of a month against a hand calculation, with two rooms Out of Order.
  - Net Room Revenue without breakfast and City Tax.
  - A consolidated report converting CHF, refused without the rate.
  - Every report kind runs, with comparisons.
  - Pickup.
- Invoices test: CSV keeps negative numbers plain. Worker test: a weekly report is queued as PDF on Monday, once; a user without the right gets nothing and the schedule stops.
- All packages typecheck and pass; tenant SQL check clean.
- Walkthrough (6/6):
  1. Occupancy total equals the SQL hand calculation, with a room Out of Order.
  2. Last-year and previous-period columns appear; weeks start on Monday.
  3. Spreadsheet and PDF export work.
  4. The consolidated report is refused without the CHF rate, then converts at 1.06 with a line per property.
  5. A weekly schedule is queued as PDF to the scheduling user only.
  6. Front Desk sees no report and the export answers 403.
- Exports appear in `report_exports`.

**Review fixes**
- Mail outbox moved from the control schema into the tenant schema (ADR 0006: hotel data stays with the tenant).
- Pickup rewritten as per-date aggregates, with no per-date scans.
- Fees count their Corrections.
- CSV no longer prefixes negative numbers.
- Receivables age by invoice date at the end of the period.
- Cash Differences are by Business Date.
- Comparisons extended beyond Occupancy, and the room type filter to pickup and cancellations.
- Report rights go through the shared check (`allowedAmong`).
- Support sessions cannot create schedules.
- New tables registered in the Drizzle aggregate.

**Open points**
- Budget comparison comes with ticket 83; the report builder and raw export with ticket 84.
- No commission in source mix: nothing records it until the channel connection (ticket 37).
- Pickup counts a stay as booked from creation until cancellation, and prices it at today's price. Later changes of dates or room type are not traced (no history of edits). Last year's pace uses the same rule.
- Revenue by Service and Tax Code is a financial report (Property Manager, Accounting), not open to Revenue. Owner decision: should Revenue see it?
- Exchange rates are typed per report; there is no rate source.
- Scheduled reports are sent from the outbox once mail exists (ticket 39). A worker that is down all Monday or the 1st skips that week's or month's report (no catch-up).
- Report PDFs embed both full fonts, as the other documents do, so attachments are about 1 MB.
- Housekeeping and Cash reports have no period comparison.
