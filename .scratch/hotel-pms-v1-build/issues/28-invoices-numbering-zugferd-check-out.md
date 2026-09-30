# 28 — Invoices with gap-free numbering, ZUGFeRD PDF, Deposit Invoice and check-out

**What to build:** Front Desk issues an Invoice from a Folio: one gap-free number range per Legal Entity with configurable format assigned only at issue, optional separate ranges for deposit and cancellation invoices; the PDF is a ZUGFeRD document with the UStG §14 contents, XRechnung XML on request; master data is historised so any invoice re-renders identically. Money received before check-in triggers an automatic Deposit Invoice netted on the final invoice. Check-out requires every guest Folio at zero, or an on-account Bill-to that becomes a Receivable, or a Manager override; check-out sets the reservation Checked-out and the room Dirty. Invoice and Receipt stay separate documents.

**Blocked by:** 27 Payments: Stripe onboarding, Card Holds, Tenders and refunds

**Status:** ready-for-agent

- [ ] Two invoices issued in parallel get consecutive numbers without gap or duplicate under load
- [ ] ZUGFeRD PDF validates with a public validator
- [ ] Deposit Invoice is netted on the final invoice with VAT shown correctly
- [ ] Check-out with an open guest balance is refused
