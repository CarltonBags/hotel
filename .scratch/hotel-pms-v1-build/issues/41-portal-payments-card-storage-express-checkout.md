# 41 — Portal payments, card storage and express checkout

**What to build:** In the Guest Portal the guest pays the deposit or balance by card with strong customer authentication, or stores a card for incidentals (off-session use later), which secures a Card Guarantee; on the departure eve the express checkout link lets the guest review the folio, pay, and download the invoice; the reservation is checked out by staff or automatically where the property allows it. Payments land on the folio as Payments with their tender; a Deposit Invoice follows automatically.

**Blocked by:** 40 Guest Portal with Portal Link and Pre-check-in, 27 Payments: Stripe onboarding, Card Holds, Tenders and refunds

**Status:** ready-for-agent

- [ ] 3-D Secure payment completes and the folio updates
- [ ] Stored card is charged later by staff without the guest present (merchant-initiated)
- [ ] Express checkout with zero balance produces the final invoice for download
- [ ] Declined payment shows a clear message and alerts nobody twice
