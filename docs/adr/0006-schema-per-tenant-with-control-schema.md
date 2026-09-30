---
status: accepted
---

# One Postgres schema per tenant, plus a shared control schema

Each tenant's hotel data lives in its own Postgres schema; a single shared control schema holds tenants, users, sessions, role assignments, subscription, devices and external-id mappings. The staff app is served on a tenant subdomain, which selects the schema before login, and every request sets the search path inside its transaction. We chose this over a shared schema with row-level security because the product owner wants isolation that is visible and explainable to hotel customers and allows per-tenant export and restore.

## Consequences

- Every migration runs once per tenant and must be expand/contract; deploy time grows with tenant count.
- Cross-tenant analytics need a separate path; cross-property queries inside one tenant stay simple.
- Pooled connections must never carry a session-level search path.
- Webhooks arrive without a subdomain and resolve their tenant through the control schema.

## Considered Options

- Shared schema, tenant_id and row-level security: cheapest to operate, recommended by the agent, rejected for the isolation story.
- Database per tenant: strongest isolation, rejected for operating cost in v1.
