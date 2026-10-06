# 41 — Portal payments, card storage and express checkout

**What to build:** In the Guest Portal the guest pays the deposit or balance by card with strong customer authentication, or stores a card for incidentals (off-session use later), which secures a Card Guarantee; on the departure eve the express checkout link lets the guest review the folio, pay, and download the invoice; the reservation is checked out by staff or automatically where the property allows it. Payments land on the folio as Payments with their tender; a Deposit Invoice follows automatically.

**Blocked by:** 40 Guest Portal with Portal Link and Pre-check-in, 27 Payments: Stripe onboarding, Card Holds, Tenders and refunds

**Status:** in review (PR stacked on ticket 40)

- [x] 3-D Secure payment completes and the folio updates
- [x] Stored card is charged later by staff without the guest present (merchant-initiated)
- [x] Express checkout with zero balance produces the final invoice for download
- [x] Declined payment shows a clear message and alerts nobody twice

## Comments

**Built**
- **Payment provider:** online payments and card setups for the guest, on the property's connected account (Stripe Payment Element with Stripe.js in the guest's browser; card numbers never reach our servers, only tokens). Merchant-initiated charges on a Card Guarantee. The stand-in provider simulates success and decline; a test button pair replaces the form in development.
- **What the guest pays:** before arrival, what the stay's Payment Policy asks ahead (whole stay, a share, or the first night) less what was received; in house, the open amount on their own folios. Payments post with Tender card online; a payment before check-in gets its Deposit Invoice in the same transaction.
- **Card Guarantee:** the guest may keep the card when paying (not ticked for them) or only leave a card. One card secures a stay at a time; the newest replaces the older. Staff see it on the reservation (brand and last four only) and charge it without the guest, with the right to take payments.
- **Declines:** shown plainly on the result page. A card refused inside the payment form is settled as declined there. The desk is told once, by whoever sees the decline first (the guest's page or the provider's webhook); a payment the guest simply left is not reported as a decline.
- **Express Checkout:** from the departure eve to the departure day (by the Business Date), checked in. The guest reviews their folio and pays. With nothing due, the guest checks out alone where the property allows it and downloads the final invoice; elsewhere, or when a folio cannot be settled in the portal (a company's), the desk sees the request and checks out.
- **Unfinished payments:** cancelled at the provider after 30 minutes (or when the guest starts another), so a late completion cannot take money we do not record and they never block a check-out.
- **Glossary:** Card Guarantee widened (left in the portal, charged for extras), Express Checkout added.

**Verified**
- All packages typecheck and pass; db `portal-payments.test.ts` covers: nothing due, two payments at once never both open, a deposit before arrival with its Deposit Invoice, a decline told once, a kept card, a merchant-initiated charge and decline, a card left without paying, Express Checkout asked and alone with the invoice.
- Walkthrough 13/13: pay section with the amount due; Express Checkout listed; a declined card says so; the desk is told once (not again on reload); keeping the card not pre-ticked; a payment with the card kept; the folio and Card Guarantee; staff see and charge the card; the desk asked without the property's leave; the request recorded; checked out alone with the invoice; the invoice downloads.

**Review fixes**
- **Expired links:** payments, cards and Express Checkout now use the portal's own link check (open until 30 days after departure).
- **Deposit before arrival:** the portal asked only for the folio balance, which is zero before arrival; it now asks what the Payment Policy wants ahead.
- **Paying twice:** a second payment cannot start while one is still being confirmed.
- **Stripe declines:** a decline in the form or after 3-D Secure left the payment waiting; it is now cancelled and settled as declined. A declined or authentication-required charge on a Card Guarantee is cancelled and failed instead of waiting for ever.
- **Desk told twice or never:** the notice is claimed atomically, also from the webhook.
- **Stored-card charge without an answer:** kept and sent again with the same request key, so the card is never charged twice; a definite no fails it.
- **Duplicate Card Guarantees:** one secured card per stay (unique index, reservation lock); a revisited old result page no longer brings back a replaced card.
- **Express Checkout:** only a blocked check-out goes to the desk; other errors show. The window follows the Business Date.
- **Card setups:** one provider customer per stay and a request key per attempt.
- **Test buttons:** only for the stay's own payment or card.
- **Smaller:** "Card on file" wording, unused card sources, rounding and locking as for desk payments, one card label, one folio lookup, the checked-out view rendered once, a misleading migration comment, a worker pass that one bad row could stop.

**Open points**
- **Booker's link:** the booking-level link cannot pay for all rooms yet; each room pays on its own link.
- **Incidentals beyond the Payment Policy before arrival:** a Card Guarantee is charged by staff, not by the guest.
- **Decline notice from the page:** is sent while the result page renders (claimed once, so never twice).
