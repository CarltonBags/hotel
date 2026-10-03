# 31 — Approvals, role limits, Price Override and the audit log screen

**What to build:** When an action exceeds a role's limit (refund above the property limit, Paid-out above limit later, Price Override below Price Floor, complimentary night) the system asks for Approval: the Property Manager enters their credentials on the same screen or approves from a notification remotely; the action is recorded under the requesting user with "approved by"; requests expire after 24 hours. Front Desk changes a night's price with a mandatory reason at or above the floor; Revenue's Price Floor protects below. Property Manager opens the property-wide audit log (Accounting sees money entries) with filters by user, record and action.

**Blocked by:** 27 Payments: Stripe onboarding, Card Holds, Tenders and refunds, 13 Worker service: jobs, schedules, live updates and webhook intake

**Status:** in review (pull request on branch ticket-31-approvals, stacked on ticket-30-city-tax)

- [x] Refund above limit: blocked, then allowed after remote Approval, recorded with both names
- [x] Expired Approval request cannot be used
- [x] Price Override below floor without Approval is refused; complimentary needs a reason
- [x] Audit log lists reservation edits, voids, overrides and approvals

## Comments

**Built (2026-10-03).**

**Approval.** An action beyond the user's limit is refused, naming exactly what needs consent (kind, the action's own key, a readable summary). The screen then offers:
- **Ask a Property Manager.** The request is stored and every Property Manager of the property is notified, with a link to that property's Approvals page. They approve or reject with an optional note, and the requester is notified with a link back to the reservation. The requester then does the action again.
- **A manager approves here.** The manager's username and password are checked without signing them in. This happens only when the action needs it, gives one answer for every failure, and allows 5 failures per requester per 15 minutes.

A consent covers exactly one action (same payment and amount, same nights and prices, same requester). It is used once, in the action's own transaction, and expires 24 hours after the request. Self-approval is refused.

**Uses.**
- **Refund above the property limit:** the payment records both `posted_by` and `approved_by`.
- **Price Override** ("Change prices" under Prices per night; Front Desk and Property Manager):
  - A reason is mandatory, and included Services keep their price; price 0 makes the night complimentary.
  - Below the room type's Price Floor, or complimentary, needs an Approval (Property Managers hold it themselves).
  - Invoiced nights and nights already slept by a guest in house are refused; their Charges are corrected on the folio.
  - A checked-in stay's Charges follow at once. It is logged as reservation change "Price Override" with "approved by", shown in the history.

**Audit log** (Reports → Audit log): reservation changes, Charge posts, voids and moves, payments and refunds, invoices and Cancellation Invoices, matched transfers, rate changes, and Approvals requested, given, rejected or granted on the same screen.
- Filters: period (property dates), user, record text (booking, invoice, guest; searched as typed), area, action.
- Property Manager sees everything; Accounting sees the money entries, including Cancellation Invoices with their reason. Front Desk has no access.

**Rights:** `override_prices` (PM, FD), `approve_requests` (PM), `view_audit_log` (PM, AC), `view_full_audit_log` (PM).

**Verified:**
- 336 tests green, plus typecheck and the tenant SQL lint.
- Browser walkthrough 13/13, run with two users at once:
  - Front Desk's refund refused; request; manager notified; approved on the Approvals page; requester notified; refund done with both names; Approval used.
  - Override below the floor; wrong manager password refused with the prompt kept; approved on the same screen; history shows "approved by".
  - Audit log entries and area filter; Front Desk refused.

**Review fixes applied:**
- German term Freigabe; `username` instead of "login" in code.
- Credentials checked only when needed, with a uniform error and an attempt limit.
- Slept nights and nights without a room part refused.
- Expiry decided on the database clock.
- Audit log: action filter, escaped search, period bounds in every source.
- The notification opens the request's property; refund approvals link to the reservation.
- Simpler action wrappers; the check-out override note retargeted (the matrix gives it to the Property Manager alone).

**Open points:**
- Paid-out above the limit comes with the cash ticket and needs one more Approval kind.
- No sanity cap on a raised night price (a typo like 60,120 is accepted); say if a cap is wanted.
- The failed-attempt limit is per server instance (in memory); a shared limit comes with the security hardening of sign-in.
- Complimentary is a price of 0 in the same form, not a separate action; it has its own reason and Approval kind.
- Not in the audit log yet: cancelled pending payments, Card Hold captures, City Tax exemptions, guest profile changes (tenant-wide), settings changes.
- The 24 hours run from the request, so an approval given late leaves less time to use it.

