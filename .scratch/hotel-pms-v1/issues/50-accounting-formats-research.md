# Austrian and Swiss accounting formats

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

Which accounting import formats do tax advisors and hotels in Austria and Switzerland use, and what do they require? Report from primary sources for Austria (BMD, RZL, the Austrian use of the German advisor format) and Switzerland (Abacus, Bexio, Banana, Sage): file formats and fields for booking lines and debtors, tax codes, document linking, charts of accounts in common use, and how exports are delivered (file, portal, interface). Also report how card provider payout reports (Stripe) are structured, so payouts and fees could be booked. Recommend formats for v1 and list what the accounting export must carry to serve them.

## Answer

Findings: [accounting-formats-at-ch.md](../../../docs/research/accounting-formats-at-ch.md)

- **Recommendation for v1**: keep the two formats of the draft in "Accounting export (DATEV) mapping": the German advisor booking batch, now with a country profile (Austrian chart and tax keys), and the documented neutral CSV, extended to the field list in section 5. Add native writers only for countries that have a pilot hotel: RZL and BMD for Austria, Abacus XML for Switzerland. bexio (API per company), Banana and Sage/Infoniqa come later.
- **Austria**: RZL publishes a full specification (semicolon text, Windows-1252, 41 fields, tax as rate key plus code plus tax amount, document path field) and also reads the German batch at its 2011/2015 level. BMD's official specification is not public; its CSV columns are known only from third-party exporters and must be confirmed with a pilot advisor.
- **Switzerland**: no common exchange format. Abacus takes XML with one grouped entry per document; bexio takes bookings through its API with the company's own account and tax ids; Banana takes tab-separated text. Tax codes are per client everywhere.
- **Key requirements**: the export model must carry net, tax and gross per line; tax as rate, direction, target code and country; document grouping and document type; a short numeric form of the document number (10 digits); both currencies with rate; the deposit chain; document files in a folder beside the booking file; a run identity against double import.
- **Card payouts**: the provider's itemized payout reconciliation report gives gross, fee and net per transaction and per payout, only with automatic payouts. Booking payouts and fees needs the provider's payment id and the hotel's references as metadata on every card payment. Not in v1; the report is offered as a download.
- **UNVERIFIED and left for the pilot advisor**: BMD field specification and tax codes, Austrian tax keys of the German format, Sage/Infoniqa fields, account numbers of the Swiss charts, tax treatment of provider fees, market shares of the products.
