# 10 — Monorepo, control schema, tenant schema and sign-in

**What to build:** A staff user opens the app at their tenant's subdomain, signs in with email and password, and sees a page naming their tenant and user. Behind it: the pnpm/Turborepo monorepo with the staff app, guest app, worker and shared packages (domain, db, ui); the shared control schema (tenants, users, sessions, role assignments, devices, external id mappings) and one Postgres schema per tenant, provisioned by a command; Better Auth self-hosted in the control schema; every tenant query inside a transaction that sets the search path for that transaction only, so pooled connections never leak a tenant; the per-tenant migration runner that records the version per tenant in the same transaction, stops on the first failure and is re-runnable; CI fails on any schema-qualified name in generated tenant SQL. Follows ADR 0006, 0007, 0008 and the constraints in the schema-per-tenant research. The provider stays swappable behind the data layer until gate 1 gives its verdict.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Two tenants provisioned; a user of one cannot reach the other's data, proven by a test that runs parallel transactions through the pooled connection
- [ ] Migration runner rolls a migration across all tenants, records versions, stops on an injected failure and resumes
- [ ] Sign-in works at <tenant>.<app-domain>; unknown subdomain shows a neutral page
- [ ] CI check rejects schema-qualified tenant SQL
- [ ] Design tokens from the prototype (light and dark) live in the ui package
