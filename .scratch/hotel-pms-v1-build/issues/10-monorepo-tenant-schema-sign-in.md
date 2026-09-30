# 10 — Monorepo, control schema, tenant schema and sign-in

**What to build:** A staff user opens the app at their tenant's subdomain, signs in with email and password, and sees a page naming their tenant and user. Behind it: the pnpm/Turborepo monorepo with the staff app, guest app, worker and shared packages (domain, db, ui); the shared control schema (tenants, users, sessions, role assignments, devices, external id mappings) and one Postgres schema per tenant, provisioned by a command; Better Auth self-hosted in the control schema; every tenant query inside a transaction that sets the search path for that transaction only, so pooled connections never leak a tenant; the per-tenant migration runner that records the version per tenant in the same transaction, stops on the first failure and is re-runnable; CI fails on any schema-qualified name in generated tenant SQL. Follows ADR 0006, 0007, 0008 and the constraints in the schema-per-tenant research. The provider stays swappable behind the data layer until gate 1 gives its verdict.

**Blocked by:** None — can start immediately

**Status:** done

- [x] Two tenants provisioned; a user of one cannot reach the other's data, proven by a test that runs parallel transactions through the pooled connection
- [x] Migration runner rolls a migration across all tenants, records versions, stops on an injected failure and resumes
- [x] Sign-in works at <tenant>.<app-domain>; unknown subdomain shows a neutral page
- [x] CI check rejects schema-qualified tenant SQL
- [x] Design tokens from the prototype (light and dark) live in the ui package

## Comments

2026-09-30: built and reviewed. All acceptance boxes met locally (28 tests, typecheck, both apps build, HTTP walkthrough with Host headers: bare domain and unknown hosts show the neutral page, sign-in scoped per tenant, an alpha session is refused at beta, the raw Better Auth endpoint refuses a foreign tenant with 401).

Points for the owner, found in review:
- **Email uniqueness vs ADR 0001.** Better Auth looks a user up by email globally, so `control.user.email` is unique platform-wide in this version. ADR 0001 says a person at two hotel companies has two accounts; with one email address that is impossible right now. Options: accept as a v1 constraint (amend ADR 0001), or scope the auth adapter per tenant in ticket 11 (a wrapper that adds `tenant_id` to every user lookup). Decision needed before ticket 11 creates users.
- **Pooler.** The isolation tests run against a local node-postgres pool, which reuses connections like PgBouncer in transaction mode does. The same test against Neon's pooled endpoint belongs to gate 01.
- **Defaults chosen without a ticket:** sessions expire after 12 hours, refreshed every 15 minutes; minimum password length 10; reserved subdomains `www, api, app, admin, status, help, mail, guest, worker`. Confirm or change in ticket 11 / 14.
- Migrations are hand-written SQL under `packages/db/migrations`; drizzle-kit generation is not used, so the CI check guards the hand-written files. Drizzle schema files mirror them for typed queries.
- `attachDatabasePool` (Vercel fluid compute) is not wired; belongs with the deploy work in ticket 13.
