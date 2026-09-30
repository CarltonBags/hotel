# Cash handling and fiscal cash-register obligations

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 10

## Question

The DACH research shows a PMS that records cash or voucher payments is a TSE-obligated Kassensystem in Germany (KassenSichV, AEAO §146a) and RKSV applies in Austria even to card payments. Decide for v1: card and bank-transfer only with cash explicitly unsupported in the PMS, or integrate a cloud TSE provider (e.g. fiskaly) and an RKSV signature service. Record the consequence for the folio model, the receipt (Beleg) format, DSFinV-K export, and the go-to-market claim.

## Answer

Resolved 2026-09-28 by grilling.

**Decision**: cash is in v1, behind one **fiscal module** that uses a cloud fiscal service provider. Germany: cash and voucher transactions are signed by a certified security device. Austria: every receipt is signed, including card payments. The provider is chosen in "Fiscal service provider selection".

**Per-property switch**: a property turns its cash desk on or off. Austrian properties always run the fiscal module. Whether the off-switch frees a German property from the fiscal duty is unconfirmed, because German rules look at what the software can do, not what is used; ticketed in "Tax advisor confirmation of fiscal and voucher rules".

**Cash desk**
- A property defines one or more **Cash Registers** (for example Front desk 1, Bar).
- A user opens a **Shift** on a register with a counted opening float and closes it with a count by denomination. The count is blind: the expected amount appears only after the count is entered.
- The difference is booked to a cash-difference account. Above the property tolerance, default 5.00, a reason is mandatory and the Property Manager is notified.
- The **Cash Book** lists every movement per register with a running balance.

**Cash movements**: guest payments in cash; cash refunds to guests; **Paid-outs** for small expenses (amount, reason, receipt photo, expense account); bank deposits and change money; transfers between registers; tips paid out to staff.

**Vouchers** (owner's choice; the agent recommended leaving them out of v1)
- Value vouchers only: an amount, redeemable against any charge, partial redemption with remaining balance.
- Sold at the desk by any tender and online on the hosted booking page by card, delivered by email with a code.
- Redeemed at the desk as a Tender on a folio. Not redeemable in the online checkout in v1.
- Valid at any property of the Legal Entity that sold it.
- Treated as taxed at redemption, so the sale is a liability and not revenue; to be confirmed by the tax advisor.
- Redemption counts like cash under German fiscal rules and is signed.

**Receipts**: every payment at the desk produces a **Receipt** with the fiscal data and QR code, offered by email or as a code to scan, printed on request. Invoice and Receipt are separate documents.

**Outage** of the fiscal service: the desk keeps working, receipts carry the notice the law prescribes, start and end are logged, the Property Manager is alerted, and long outages are listed for the notification duty. Exact rules per country come from the provider research.

**Consequences elsewhere**
- Tenders gain "cash" and "voucher" beside those in the folio ticket.
- The Night Audit warns about Shifts still open at close.
- Export for tax audits (German cash data export, Austrian data collection log) is part of the fiscal module.
- Each Cash Register is registered with the tax office; the system provides the data.

**Permissions** (reviewed and accepted by the owner in "Permissions for cash, vouchers and outlet roles"): open and close Shift, take and refund cash, sell and redeem vouchers: Front Desk, Property Manager. Paid-outs: Front Desk up to a property limit, above with Approval. Bank deposit, transfers, view all Cash Books: Property Manager, Accounting. Front Desk sees the Cash Book of its own open Shift.

- ADR: `docs/adr/0013-cash-and-fiscal-module-in-v1.md`.

> Update 2026-09-28 from "Fiscal service provider selection", which corrects three points above:
> - **Signed scope**: in Germany every desk process that ends in a receipt is signed whatever the tender, not only cash and vouchers (pending tax advisor). In Austria only payments made on site are signed.
> - **Outage**: Germany has no duty to report outages to the tax office. Austria does for outages over 48 hours, within one week, and the end is reported too.
> - **Printer**: from 1 October 2026 Austria accepts electronic receipts readable on site but a printed receipt must be given on request, so every Austrian desk needs a printer.
> - The provider keeps signed data for three months only; the product must export and archive it on a schedule.

> Update 2026-09-29: without a booking page there is no online voucher sale. Vouchers are sold and redeemed at the desk only.
