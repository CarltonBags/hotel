# Reporting scope

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: -

## Question

Which reports does v1 ship, and how are they defined? Decide the list (occupancy, average daily rate, revenue per available room, pickup and pace, source and channel mix, revenue by Service and Tax Code, City Tax, housekeeping performance, cancellations and no-shows, receivables ageing, cash), the exact definition of each figure (which rooms count as available: Out of Order excluded or not; complimentary and house use; day use), the date basis of each (Service Date, Business Date, booking date), consolidated views across properties with currency handling, export formats, scheduled delivery, and which role sees which report. Resolve the figures into CONTEXT.md.

## Answer

Resolved 2026-09-29 by grilling.

**Fixed reports in v1**
| Report | Contents | Date basis |
|---|---|---|
| Occupancy and revenue | Occupancy, Average Daily Rate, Revenue per Available Room; per day, week, month; by room type | Service Date |
| Pickup and pace | Room nights and revenue gained or lost per future date since a chosen day; on-the-books occupancy for the next 90 days against the same time last year | booking date against Service Date |
| Source and channel mix | Room nights, revenue, commission per Source and channel; direct share | Service Date |
| Cancellations and no-shows | Counts, lost room nights, fees charged and waived, lead time | date of cancellation |
| Revenue by Service and Tax Code | Room, breakfast, extras, City Tax, fees, per tax rate | Service Date |
| Official tourism statistics | Defined after "Tourism statistics reporting duties" | month |
| Housekeeping performance | Rooms per person, minutes planned against actual, inspection failures, declined cleanings | Business Date |
| Receivables ageing | Open invoices by age per Company | invoice date |
| Cash | Cash Book summary, Cash Differences per user and register | Business Date |
City Tax filing and the Night Audit report are defined in their own tickets.

**Definitions**
- **Available Rooms**: all rooms of the property minus rooms that are Out of Order on that night. Out of Service rooms stay in. Every report states the base it used.
- **Occupancy**: occupied rooms divided by Available Rooms. Complimentary and house-use rooms count as occupied. A charged no-show does not.
- **Net Room Revenue**: the room component of charges, without VAT, without breakfast and other included Services, without City Tax, by Service Date.
- **Average Daily Rate**: Net Room Revenue divided by occupied rooms.
- **Revenue per Available Room**: Net Room Revenue divided by Available Rooms.
- Fees for no-show and late cancellation are revenue of their own kind, shown in their own line and outside Net Room Revenue.
- Total revenue including breakfast and extras is a separate column, never mixed into the rate figures.

**Comparisons**: previous period; same period last year with weekdays aligned; and **Budget**.

**Budget** (owner's choice beyond the recommendation): entered per property and month for occupancy, Average Daily Rate, Net Room Revenue and total revenue, by Property Manager or Revenue, or imported from a spreadsheet. The system spreads monthly values over days using last year's weekday pattern. One budget per year plus one revised forecast.

**Report builder** (owner's choice beyond the recommendation): the user picks one data set (room nights, reservations, charges, payments, housekeeping tasks), then columns, filters, grouping and totals. The result is a table. Saved reports are private or shared with the property. No joining of data sets, no formulas, no charts in v1.

**Personal data**: the builder follows the role's rights; columns a role may not see elsewhere are not offered. Every export of guest-level data is logged with user and row count. Scheduled reports containing guest names go only to users of the same property.

**Delivery**: each report opens as a Workspace Tab with filters for date range, property and room type. Export as spreadsheet file and PDF. A user may schedule a report by email daily, weekly or monthly. The Night Audit report stays unscheduled.

**Raw data export**: reservations, charges and payments for a date range as spreadsheet files.

**Several properties**: consolidated reports for users with access to more than one property, with per-property breakdown; amounts in different currencies are converted at report time with the rate stated on the report.

**Who sees what** follows "Permission matrix for fixed roles": financial reports for Property Manager and Accounting; revenue and occupancy reports also for Revenue; housekeeping performance for Property Manager and Housekeeping Supervisor; builder and budget for Property Manager, Accounting and Revenue within their rights.

> Update 2026-09-29 from "Tourism statistics reporting duties": the official tourism statistics report counts persons, not rooms, by country of residence, and uses its own room base (staff rooms are not guest rooms there, while house use counts as occupied in the internal Occupancy figure). It ships as screen, spreadsheet and PDF in the order of the official forms, without direct transmission. Definition in `docs/research/tourism-statistics.md`.
