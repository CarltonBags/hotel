# 31 — Approvals, role limits, Price Override and the audit log screen

**What to build:** When an action exceeds a role's limit (refund above the property limit, Paid-out above limit later, Price Override below Price Floor, complimentary night) the system asks for Approval: the Property Manager enters their credentials on the same screen or approves from a notification remotely; the action is recorded under the requesting user with "approved by"; requests expire after 24 hours. Front Desk changes a night's price with a mandatory reason at or above the floor; Revenue's Price Floor protects below. Property Manager opens the property-wide audit log (Accounting sees money entries) with filters by user, record and action.

**Blocked by:** 27 Payments: Stripe onboarding, Card Holds, Tenders and refunds, 13 Worker service: jobs, schedules, live updates and webhook intake

**Status:** ready-for-agent

- [ ] Refund above limit: blocked, then allowed after remote Approval, recorded with both names
- [ ] Expired Approval request cannot be used
- [ ] Price Override below floor without Approval is refused; complimentary needs a reason
- [ ] Audit log lists reservation edits, voids, overrides and approvals
