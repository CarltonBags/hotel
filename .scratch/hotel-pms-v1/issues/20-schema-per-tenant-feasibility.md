# Schema-per-tenant feasibility on Neon with Drizzle

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

"Tech stack detail and tenancy strategy" chose one Postgres schema per tenant plus a shared control schema, on Neon (eu-central-1) with Drizzle, accessed from Vercel functions through a transaction-mode pooler. Verify against primary sources: (1) practical limits on schema and table counts in Postgres and on Neon (catalog bloat, pg_dump time, autovacuum, Neon branching and storage with thousands of tables); (2) whether setting search_path per transaction (SET LOCAL) is safe through Neon's pooler (PgBouncer transaction mode) and with the Neon serverless driver over HTTP/WebSocket; (3) how Drizzle supports a schema chosen at runtime (pgSchema factories, search_path, drizzle-kit migrations applied to N schemas) and known pitfalls; (4) migration duration and failure handling when rolling several hundred schemas forward; (5) whether LISTEN/NOTIFY works on Neon direct connections and its limits; (6) how pg-boss and Graphile Worker behave with a single shared queue schema beside tenant schemas. Conclude with: feasible as chosen, feasible with named constraints, or not advisable, and list the constraints the spec must state.

## Answer

Resolved 2026-09-28 by research. Verdict: **feasible with named constraints**. Full findings and sources: [schema-per-tenant-feasibility.md](../../../docs/research/schema-per-tenant-feasibility.md).

- Tenant routing is sound: `set_config('search_path', <schema>, true)` / `SET LOCAL` as the first statement of an explicit transaction is safe through Neon's PgBouncer transaction mode. Session-level `SET` is not, and the pooler does not reset connections between clients.
- Drizzle's `neon-http` driver cannot be used for tenant data (no `db.transaction()`); use `node-postgres` over TCP with `attachDatabasePool`, or `neon-serverless` over WebSocket.
- Drizzle has no runtime-schema support. Declare tenant tables unqualified (`pgTable`), control tables with `pgSchema('control')`, own the migration runner, and fail CI on any schema-qualified name in generated tenant SQL (stable drizzle-kit emits `"public".` in foreign keys).
- Migrations: direct connection, one transaction per tenant with the version written to the control schema in the same transaction, stop on first failure, re-runnable; contract steps only after every tenant reached the expand version. Local measurement: about 28 ms per tenant for a small DDL migration on stock Postgres; not yet measured on Neon.
- Open risk: about 700 relations per tenant means 200,000+ relations at 300 tenants. Neon engineers reported trouble beyond about 10,000 relations in 2024; the fix shipped in 2025 but its production rollout is not publicly confirmed, and Neon's docs advise against schema-per-tenant. A load test on Neon at target scale is required before build start, with a named fallback provider.
- Restore and export are per tenant via `pg_dump -n` from a point-in-time branch; Neon instant restore rewinds all tenants. Whole-database dumps can fail on the lock table at this table count.
- LISTEN/NOTIFY works on direct connections only, is lost on compute restart, and payloads are visible database-wide: treat notifications as hints, keep compute always on.
- pg-boss and Graphile Worker both work with one shared queue schema; jobs carry the tenant id and identifiers only, and handlers set the search path like any request.
