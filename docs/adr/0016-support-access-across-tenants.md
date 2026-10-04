---
status: accepted
---

# Support Access: platform support staff may enter a customer's tenant for a limited time, with a stated reason

ADR 0001 keeps every user in exactly one tenant. Support needs to see what a customer sees, so there is one exception: Support Staff, users of the platform's own tenant listed as such, may open a customer's tenant for at most a few hours. Each Support Access records who, which tenant, a reason of at least ten characters, start, expiry and end; the customer's Owner sees every access and may end an active one. Inside the tenant the access acts with Tenant Admin rights, keeps no personal settings there, and its actions are recorded under the staff member's own user id. Entry goes through a one-time code that is valid for two minutes and redeemed on the tenant's own subdomain, where it is exchanged for a host-only session secret; neither the session's secret nor the platform session ever reaches the customer's subdomain in a URL.

## Considered options

- A second account per support person in each customer tenant: follows ADR 0001 to the letter, but leaves standing logins in every tenant, with no reason, no expiry and nothing for the Owner to review.
- Impersonating a customer's user: actions would look like that user's own, and the audit trail would lie.

## Consequences

- The platform needs a tenant of its own (by default the slug "platform") whose Support Staff are the only people who can start an access.
- The Owner's list is the record of every access; there is no in-app approval step before an access starts.
- Records written during an access carry a user id from the platform tenant, which the customer's own user list cannot resolve to a name.
