# 28 — Invoices with gap-free numbering, ZUGFeRD PDF, Deposit Invoice and check-out

**What to build:** Front Desk issues an Invoice from a Folio: one gap-free number range per Legal Entity with configurable format assigned only at issue, optional separate ranges for deposit and cancellation invoices; the PDF is a ZUGFeRD document with the UStG §14 contents, XRechnung XML on request; master data is historised so any invoice re-renders identically. Money received before check-in triggers an automatic Deposit Invoice netted on the final invoice. Check-out requires every guest Folio at zero, or an on-account Bill-to that becomes a Receivable, or a Manager override; check-out sets the reservation Checked-out and the room Dirty. Invoice and Receipt stay separate documents.

**Blocked by:** 27 Payments: Stripe onboarding, Card Holds, Tenders and refunds

**Status:** in review (pull request on branch ticket-28-invoices, stacked on ticket-27-payments)

- [x] Two invoices issued in parallel get consecutive numbers without gap or duplicate under load
- [x] ZUGFeRD PDF validates with a public validator
- [x] Deposit Invoice is netted on the final invoice with VAT shown correctly
- [x] Check-out with an open guest balance is refused

## Comments

**Built (2026-10-03).**

**Number ranges.** Gap-free per Legal Entity (Settings → Legal Entities → Invoice numbers):
- Invoices always have a range; deposit and cancellation invoices use their own only when one is set.
- Formats look like RE-{YYYY}-{NNNNN}, limited to letters, digits and - _ / . so numbers travel safely. A year in the format restarts the counter yearly, and the year only moves forward.
- A first number can be set to continue from an earlier system.
- Numbers are assigned inside the issuing transaction, so a failed issue (such as a refused check-out) leaves no gap. Tested with parallel issues.

**Invoices.**
- Lines group a Service's Charges on consecutive Service Dates. VAT is computed per Tax Code from gross, split once (ADR 0010).
- Each invoice freezes its full document: seller, buyer, lines, totals and deposits. The PDF and XML are rendered once and kept.
- Issuing needs the seller's full address and its VAT ID or tax number (UStG §14(4)), and a guest address for invoices over 250 €.
- The PDF is ZUGFeRD / Factur-X EN16931, PDF/A-3, with an embedded Inter font. XRechnung (CII) XML is available on request; it needs the seller's invoice email and phone. A Company's Leitweg-ID is the buyer reference.
- Mustang validates the deposit invoice, the final invoice and the XRechnung XML. `scripts/validate-invoice.sh` validates any file with a portable runtime.

**Deposit Invoice.** Money received before check-in gets a Deposit Invoice in the same transaction as the payment, with the stay's VAT in proportion.
- A payment before check-in is refused while the stay is not taxable as a deposit, which needs the Rate Plan's Accommodation Service.
- The final invoice deducts deposits with their VAT and shows other payments. A partly refunded deposit is netted for the amount kept.

**Check-out** (Abkassieren in the Today workspace, Check-out on the reservation tab) issues every open folio. It then needs each folio settled.
- An on-account Company's folio, or a payment "on account", becomes a Receivable.
- A Property Manager may override; what stays unpaid is then kept as a Receivable.
- Pending refunds count as owed.
- Invoiced Charges are closed: no void and no move.

**Verified:**
- 299 tests green, plus typecheck, lint and the tenant SQL lint.
- Browser walkthrough 9/9: a deposit invoice for a bank transfer before check-in, check-out refused with an open balance (nothing issued), check-out after payment with the final invoice, the PDFs and XRechnung validated by Mustang, invoiced Charges locked.

**Review fixes applied:**
- Deposit invoice inside the payment transaction.
- "On account" no longer counts as paid.
- Seller and recipient checks per §14.
- The yearly reset only moves forward, and a set first number is kept.
- Safe number formats.
- Pending refunds no longer block check-out.
- Deposit received date in the property's time zone.
- Override leaves a Receivable.
- Refunded deposits netted for the amount kept.
- EN16931 VAT computed per rate, with a rounding amount for the gross cent.
- Consecutive-date periods only.
- Files kept at first render; the PDF date is fixed to the issue date.
- Property lock first.
- Leitweg-ID on Companies.

**Open points:**
- The room turning Dirty at check-out comes with room status (ticket 33).
- A refunded deposit's correcting document, and cancellation invoices, come in ticket 29.
- A deposit paid to a folio that ends without Charges (all routed to a Company) shows as a credit and blocks check-out until it is moved or refunded.
- Tax rate 0 maps to EN16931 category Z; City Tax outside VAT scope (O) comes with ticket 30.
- Gate 03: the tax advisor confirms the deposit VAT split and the early-departure fee's Tax Code.
- Receipts (fiscal) stay separate and come with their ticket.
