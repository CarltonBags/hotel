---
status: accepted
---

# A Charge of a closed Business Date is corrected, never voided; "closed" means posted on a closed day for a closed night

Once the Night Audit closes a Business Date, its records cannot change. Because all nights are posted at check-in (ADR 0009), a Charge posted on a now-closed day may still be for a night that has not happened yet; a shortened stay must be able to void it without touching the closed day's revenue, which goes by Service Date. A Charge is therefore closed only when both its Business Date (the day it was posted) and its Service Date are before the property's open Business Date. Such a Charge is never voided: a Correction of the opposite amount is posted on the open Business Date, on the same folio, for the same Service Date and Tax Code, naming the original. A database trigger refuses the void of a closed Charge whatever path tries it.

## Considered options

- Closed by Business Date of posting alone: every future night posted at check-in would become uncorrectable by a normal void after the first audit, and early departures would need Corrections for nights that never took place.
- Closed by Service Date alone: a Late Arrival's missed night, posted on the open day for a past night, could only be corrected, never voided, even minutes after posting.

## Consequences

- Each audit report lists, besides the day's revenue by Service Date, the Charges posted that day for earlier nights (late postings and Corrections), so nothing falls between reports.
- An invoiced closed Charge is corrected by a Cancellation Invoice, not by a Correction.
- A Correction of a City Tax Charge files that night's tax as borne by the hotel.
