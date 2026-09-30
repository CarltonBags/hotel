# Folio, billing and invoicing domain model

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 02 05

## Question

Define Folio, Charge, Payment, Invoice, Tax and their relationships. Decide: one folio per reservation vs per guest vs per room with splits, how city tax and VAT rates apply per charge, invoice numbering and immutability per property, company billing and routing of charges, deposits and pre-authorizations, refunds and voids, multi-currency display vs settlement. Must satisfy the DACH compliance findings. Resolve the terms into CONTEXT.md.

## Answer

Resolved 2026-09-28 by grilling. Supersedes the "one reservation, one folio" wording in "Reservation and inventory domain model".

**Structure**
- A Reservation has 1..N **Folios**. One is created automatically; staff add more on demand. Each Folio has exactly one **Bill-to** (a Guest or a Company) and becomes one Invoice.
- A **Charge** is one Service for one Service Date: amount gross, Tax Code, quantity, folio. Packages split into components at posting (room, breakfast, ...), each with its own Tax Code.
- **Gross is the stored truth.** Net and VAT are derived per Tax Code. Company invoices display net plus VAT.
- One currency per Property; no conversion on folios. Chain reports convert at report time with a stated rate.
- **Service catalogue per Property**: name, default gross price, Tax Code, revenue account, posting rhythm (once, per night, per person-night), bookable online yes/no. Rate plan components reference Services. Free-text charges only for Property Manager.

**Posting**
- **All nights are posted at check-in**, as one Charge per night per component, each carrying its **Service Date**. Revenue reporting is by Service Date, never by posting date. Chosen by the product owner over nightly posting.
- Shortening a stay: the system proposes voiding future-dated Charges and posting an early-departure fee if the rate plan has one; staff confirm. Extending: the new nights are posted immediately. Room-type change: future nights voided and reposted.
- **City Tax** is a separate Charge per guest-night, computed from the Property's rule, with per-guest exemption and reason. Shown separately on the invoice and in its own report.
- **Routing Rules** per reservation decide which Folio a Charge lands on; defaults come from the Company profile (with payment term). Staff can move single Charges between Folios before invoicing.

**Money**
- **Payment** = money received. Tenders in v1: card online (Stripe), card terminal (Stripe Terminal), bank transfer, on account, OTA virtual card (keyed MOTO), OTA collect. Cash is decided in "Cash handling and fiscal cash-register obligations".
- **Card Hold** = pre-authorisation. Not a Payment, creates no invoice. Tracked with its expiry; the system warns before expiry and re-authorises; incremental holds are capped, so incidentals are batched.
- Money received before check-in is a Payment on the folio and triggers an automatic **Deposit Invoice** with VAT, netted on the final invoice (UStG §14(5)).
- Refund = negative Payment linked to the original.
- Guest folios must reach zero at checkout. A Folio whose Bill-to is on account may be invoiced unpaid and becomes a **Receivable**; Manager override for exceptions.
- Receivables in v1: open-invoice list per Company with due date and ageing, manual matching of incoming transfers, overdue list with reminder letters (levels 1-3). No bank import, no automatic dunning.

**Invoices and corrections**
- An uninvoiced Charge can be **voided** with a mandatory reason; it stays visible in the audit log and is never deleted.
- An issued **Invoice** is immutable. Correction = **Cancellation Invoice** referencing the original, then a new Invoice. Changing the recipient after issue follows the same path.
- Invoice numbers: one gap-free range per Legal Entity, configurable format, assigned only at issue. Optional separate ranges for cancellation and deposit invoices.
- Every invoice is a **ZUGFeRD PDF** (human-readable with embedded structured data); XRechnung XML on request. Master data is historised so any invoice re-renders identically.
- ADRs: `docs/adr/0009-charges-posted-at-check-in.md`, `docs/adr/0010-gross-amounts-stored.md`. ADR 0003 corrected for 1..N folios.

> Update 2026-09-28: "Cash handling and fiscal cash-register obligations" adds the Tenders cash and voucher, and the Receipt as a document separate from the Invoice.
