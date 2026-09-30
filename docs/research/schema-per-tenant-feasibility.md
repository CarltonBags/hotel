# Schema-per-tenant feasibility on Neon with Drizzle

Resolves ticket `.scratch/hotel-pms-v1/issues/20-schema-per-tenant-feasibility.md`.
Background: `.scratch/hotel-pms-v1/issues/08-tech-stack-detail.md`, `docs/adr/0006-schema-per-tenant-with-control-schema.md`.
Researched 2026-09-28 against PostgreSQL, Neon, PgBouncer, Drizzle, pg-boss and Graphile Worker documentation, source code and issue trackers.

Assumed scale: a few hundred tenants in the first years, 60-120 tables per tenant schema, properties up to 400 rooms.

How to read this file:

- Every claim cites a source id in brackets; the list is at the end.
- **MEASURED** marks numbers from a throwaway local PostgreSQL 16.14 cluster (Apple Silicon laptop, loopback, empty tables). They describe stock Postgres, not Neon. Method in the appendix.
- **UNVERIFIED** marks anything I could not confirm from a primary source or a measurement.
- **INFERENCE** marks a conclusion drawn by combining sourced facts; the facts are cited, the conclusion is mine.

Versions current at research time: drizzle-orm 0.45.3 and drizzle-kit 0.31.11 are the npm `latest`; 1.0.0-rc.4 / rc.5 exist as release candidates; pg-boss 12.35.0; graphile-worker 0.18.0; @neondatabase/serverless 1.1.0 [N1]. Neon supports Postgres 14 to 18 [NE13].

---

## 1. Practical limits on schema and table counts

### 1.1 Hard limits are irrelevant

- PostgreSQL's documented ceiling is 1,431,650,303 relations per database; identifiers are limited to 63 bytes [PG1]. No limit on the number of schemas is documented.
- Neon documents limits of 500 databases and 500 roles per branch [NE10]. It documents no limit on schemas, tables or relations per database; its plan page lists none either [NE9].

### 1.2 What "a few hundred tenants" means in relations

A relation is not only a table. Indexes, TOAST tables, TOAST indexes and sequences each count.

- **MEASURED**: 300 tenant schemas x 100 tables (identity primary key, two secondary indexes, one `jsonb` and two `text` columns, one foreign key) produced **210,413 rows in `pg_class`**: 120,164 indexes, 30,068 tables, 30,040 TOAST tables, 30,000 sequences. That is about **700 relations per tenant**.
- **MEASURED**: the same empty database occupied **1,697 MB**, about 5.7 MB per tenant before any hotel data. Catalog tables alone: `pg_attribute` 237 MB, `pg_depend` 99 MB, `pg_class` 67 MB, `pg_index` 26 MB, `pg_attrdef` 21 MB, `pg_constraint` 20 MB, `pg_type` 15 MB.
- At the upper bound in the brief (500 tenants x 120 tables) the same ratio gives roughly 420,000 relations. **INFERENCE** from the measurement.

### 1.3 Neon-specific: relation count is a known weak spot of the storage engine

This is the most important finding against the chosen approach.

- Neon engineering, epic "pageserver: support 1 million relations" (opened 2024-10-25): *"We do not currently define a maximum number of relations that we support, but it is known that beyond about 10k relations things get dicey. The exact number of issues is unknown, but the primary architectural issue is how we store RelDirectory as a monlithic blob that gets rewritten whenever we add/remove one."* [NE14]
- A production incident in the same period: *"In a customer workload, we saw slow pageserver WAL ingestion with CPU pinned at 100% ... The customer has ~100,000 relations, so this is likely quadratic behavior for large relation counts"* [NE15]. A Neon engineer's benchmark in that issue showed per-table ingestion time rising from 0.008 s at table 0 to 0.036 s at table 30,000 [NE15].
- An earlier report (2022) found multi-gigabyte layer files after restoring a schema with 1,000-2,000 relations, caused by the relation directory being rewritten on every create/drop [NE16]. Closed as fixed in 2022.
- The remedy ("reldir v2", a sparse keyspace) was merged during 2025 [NE14][NE17]. The last public status, 2025-07-02/03, says: *"We have feature flag support now ... We will gradually roll this out in the near future"*, followed by a reworked two-phase rollout plan [NE14]. The epic was then moved to a private tracker and closed on GitHub on 2025-07-25 [NE14]. A pull request to enable reldir v2 by default in regression tests was still open when checked [NE17].
- The epic's checklist marks as done: a test creating and dropping 1 million relations, and asymptotic scaling of relation create/drop and compute startup "at most O(N)". It leaves unchecked: *"A much broader test for high relation counts: ensure that compaction runtimes are as expected, that logical replication works as expected"* [NE14].
- The epic declares out of scope: *"Revising pg_stat ... code to handle large relation counts (current code skips writing pg_stat if the snapshot exceeds a size threshold)"* and *"Any postgres CLI/tooling issues around high relation counts"* [NE14].
- **UNVERIFIED**: whether reldir v2 is enabled for new projects in Neon's production fleet in eu-central-1 as of September 2026. No public source states it.

Our target (about 210,000 relations at 300 tenants) is twice the relation count of the customer that triggered the 2024 incident. The code fixes exist; their production rollout state is not publicly documented.

### 1.4 Neon's own guidance argues against this design

- Neon's multitenancy guide on schema-per-tenant: *"In Neon, we generally don't recommend this approach for SaaS applications, unless this is a design you're already experienced with."* and *"This approach doesn't reduce operational complexity or costs if compared to the many-databases approach, but it does introduce additional risks"* and *"it also limits the potential of Neon features like instant Point-in-Time Recovery (PITR), which in a project-per-customer model allows you to restore customer databases independently without impacting the entire fleet's operations"* [NE8].
- Neon recommends one project per tenant instead [NE8]. Plan limits: 100 projects on Launch, 1,000 on Scale, "can be increased on request" [NE9]. ADR 0006 rejected database-per-tenant on operating cost; this file does not reopen that decision, it records that the vendor's recommendation differs.

### 1.5 Catalog bloat and general performance

- AWS's RDS guidance (vendor documentation, not PostgreSQL project documentation) lists the effects of high relation counts: autovacuum falling behind, longer major-version upgrades and dump/restore, and *"General performance degradation due to catalog size. Each table and its associated columns will add to `pg_attribute`, `pg_class` and `pg_depend` tables which are frequently used in normal database operations."* It puts the approximate threshold for relations at "Millions" and qualifies that thresholds depend on workload and instance size [AWS1].
- **MEASURED**: with 210,000 relations present, a simple query inside `BEGIN; SET LOCAL search_path ...` took 2.0-2.5 ms on first touch of a table in a fresh session (catalog lookup plus planning), on loopback.

### 1.6 Per-connection cache memory (relevant because pooled backends are shared by all tenants)

- Tom Lane, pgsql-bugs, 2020-04-15: *"Yes, Postgres caches some information about every table your session has accessed, and no you don't have a lot of control over that, and no it isn't a bug."* and *"the amount of memory consumed this way is in the vicinity of a few tens of KB per table"* [PG11].
- A 2016 pgsql report measured about 32 kB of cache per table and noted PgBouncer's `server_lifetime` as the mitigation [PG12].
- **MEASURED**: one session that touched 40 tables in each of 300 tenant schemas (12,000 tables) grew from 1.5 MB to **232 MB** of backend memory, 213 MB of it in `CacheMemoryContext`. Growth was linear: 49 MB after 50 tenants, 86 MB after 100, 162 MB after 200.
- **INFERENCE**: behind a transaction-mode pooler every server connection serves every tenant, so each long-lived backend trends toward (tables touched across all tenants) x roughly 18-32 kB. With 300 tenants x 100 tables that is on the order of 0.5-1 GB per backend in the worst case. A 1 CU Neon compute has 4 GB RAM [NE1].
- PgBouncer recycles server connections: `server_lifetime` default 3600 s, `server_idle_timeout` default 600 s [PB2]. Neon's published PgBouncer settings list `pool_mode`, `max_client_conn`, `default_pool_size`, `max_prepared_statements` and `query_wait_timeout` only [NE1]. **UNVERIFIED**: the `server_lifetime` value Neon runs in production (the open-source default config file does not set it [NE18], which would mean the PgBouncer default applies).

### 1.7 pg_dump

- `pg_dump -n pattern` dumps one schema and its contents, with a caveat: *"When `-n` is specified, pg_dump makes no attempt to dump any other database objects that the selected schema(s) might depend upon. Therefore, there is no guarantee that the results of a specific-schema dump can be successfully restored by themselves into a clean database."* [PG5]
- pg_dump takes an `ACCESS SHARE` lock on every table it dumps [PG5]. The shared lock table holds `max_locks_per_transaction` x (`max_connections` + `max_prepared_transactions`) entries; the default for `max_locks_per_transaction` is 64 and it *"can only be set at server start"* [PG6].
- **MEASURED**: a whole-database `pg_dump -s` of the 30,000-table database **failed** at `max_connections = 100` with `ERROR: out of shared memory. HINT: You might need to increase max_locks_per_transaction.` With `max_connections = 839` (the value Neon documents for a 2 CU compute [NE1]) and `max_locks_per_transaction = 64` it succeeded in 7.5 s, using 455 MB of client memory.
- **MEASURED**: `pg_dump -n tenant_0150` for one tenant took 1.6 s and 176 MB of client memory. The memory figure indicates pg_dump still reads catalog data for the whole database when asked for one schema.
- Historical context: a 2012 pgsql thread reported pg_dump taking over 24 hours on a database with more than 20,000 schemas; quadratic behaviour was fixed for PostgreSQL 9.2, after which a 100,000-table dump fell from 125 minutes to under 4 minutes [PG13]. Old advice about "thousands of schemas break pg_dump" predates those fixes.
- Neon requires direct connections for pg_dump: *"This issue also affects tools like `pg_dump`, which relies on `SET` statements. Always use direct connections for `pg_dump`."* [NE1]
- Neon does not let users set instance-level parameters; Scale-plan customers can ask support [NE7]. **UNVERIFIED**: Neon's production value of `max_locks_per_transaction`. It is absent from Neon's published parameter table [NE7]; Neon's own many-relations tests set it to 16384 explicitly [NE19], which suggests the default is not sufficient for very large relation counts.

### 1.8 Autovacuum

- *"Each worker process will check each table within its database and execute `VACUUM` and/or `ANALYZE` as needed."* At most `autovacuum_max_workers` run at once [PG7]. All tenant schemas live in one database, so every worker pass walks every tenant's tables.
- Autovacuum decides from the cumulative statistics system [PG7]. On Neon: *"Statistics collected by the Postgres cumulative statistics system are not saved when a Neon compute (where Postgres runs) is suspended due to inactivity or restarted."* [NE7] **INFERENCE**: on a compute that suspends or restarts often, dead-tuple counters restart from zero, so low-traffic tenant tables can stay below the vacuum threshold for a long time.
- Wraparound protection needs every table vacuumed *"at least once every two billion transactions"* [PG7]; with 30,000+ tables that is a large amount of background work arriving together. **INFERENCE**.
- **MEASURED**: a manual database-wide `VACUUM (ANALYZE)` over 30,000 empty tables took 23 s.
- **UNVERIFIED**: Neon's `autovacuum_max_workers` and `autovacuum_naptime` values; they are absent from the published parameter table [NE7].

### 1.9 Neon branching, restore and storage

- A branch is a copy-on-write clone of the whole branch: *"By default, branches are created with all of the data that existed in the parent branch."* [NE11]
- Restore is branch-wide: *"All databases on a branch are restored"*; *"the operation applies to all databases on the branch, not just the one you are troubleshooting"*; existing connections are interrupted during the restore [NE12]. There is no per-schema restore.
- **INFERENCE**: the per-tenant restore promised in ADR 0006 cannot use Neon's instant restore in place. The workable path is: create a branch at the target point in time, `pg_dump -n <tenant>` from that branch over a direct connection, restore into the production branch. History window is up to 7 days on Launch and up to 30 days on Scale [NE9].
- Branch allowance: 10 per project on Launch, 25 on Scale, extra branches billed [NE9].
- Storage is billed per GB-month on paid plans [NE9]. About 5.7 MB per empty tenant (**MEASURED** on stock Postgres) is small in cost terms. **UNVERIFIED**: how Neon's storage accounting treats many small relations and the history retained for them.
- **UNVERIFIED**: branch creation time and compute start time at 200,000+ relations. The epic claims compute startup scaling was measured as at most O(N) [NE14]; no figures are published.

---

## 2. `SET LOCAL search_path` through the pooler and the serverless driver

### 2.1 PostgreSQL semantics

- *"The effects of `SET LOCAL` last only till the end of the current transaction, whether committed or not."* [PG2]
- Outside a transaction block `SET LOCAL` *"emits a warning and otherwise has no effect."* [PG2] **MEASURED**: confirmed; the statement returns `WARNING: SET LOCAL can only be used in transaction blocks` and `search_path` stays at the role default.
- *"The function `set_config` provides equivalent functionality"* [PG2]. `set_config('search_path', $1, true)` accepts a bind parameter, which `SET LOCAL` does not. **MEASURED**: the value reverted after `ROLLBACK` and after `COMMIT`.
- Plain `SET` inside a committed transaction persists *"until the end of the session"* [PG2].

### 2.2 PgBouncer transaction mode

- *"Transaction pooling: A server connection is assigned to a client only during a transaction. When PgBouncer notices that the transaction is over, the server will be put back into the pool."* [PB1]
- PgBouncer's feature table lists `SET/RESET` as "Never" compatible with transaction pooling [PB1]. That entry concerns session-level `SET`.
- In transaction mode PgBouncer does **not** clean the server connection between clients: *"When transaction pooling is used, the `server_reset_query` is not used, because in that mode, clients must not use any session-based features"*; `server_reset_query_always` defaults to 0 [PB2]. A session-level `SET search_path` therefore stays on the server connection and is inherited by whichever client gets it next.
- **INFERENCE** from [PG2] and [PB1]: `SET LOCAL` issued inside an explicit transaction is safe, because the server connection is held for the whole transaction and the setting ends with the transaction. PgBouncer's own documentation does not state this in so many words.

### 2.3 Neon's pooler

- *"Neon uses PgBouncer in transaction mode (`pool_mode=transaction`)"*; settings: `max_client_conn=10000`, `default_pool_size=0.9 * max_connections`, `max_prepared_statements=1000`, `query_wait_timeout=120` [NE1].
- Neon's pooling page names this exact pitfall, *"The most common issue users encounter is with `SET` statements, particularly `SET search_path`"*, and offers three remedies: direct connection, schema-qualified names, or `ALTER ROLE ... SET search_path` [NE1]. It does not mention `SET LOCAL`. None of the three remedies fits a schema chosen per request.
- Neon does endorse transaction-local settings on the pooled endpoint elsewhere:
  - Guide, July 2026, section "Connection pooling and the `SET LOCAL` trap": *"With a plain `SET`, the value stays on that connection after your transaction ends. The next request that reuses it picks up your tenant, and now one user reads as another. The fix is to tie the variable to the transaction so it clears as soon as the transaction ends"*, with a Drizzle `db.transaction` example calling `set_config('app.current_org', ${orgId}, true)`, and *"`set_config(..., true)` is just the function form of `SET LOCAL`. Both reset when the transaction ends, so a reused connection never carries one tenant's context into another request."* [NE5]
  - Same guide's checklist: *"Set tenant context with `SET LOCAL` (or `set_config(..., true)`), and always verify through the pooled endpoint, not a direct connection."* [NE5]
  - Another guide: *"Pooled connections don't keep them either, because Neon's pooler runs PgBouncer in transaction mode, which drops `SET` values between transactions. When you need non-default values at query time, use a WebSocket `Client` session or a direct connection, or run `SET LOCAL` inside the same transaction as the query."* [NE6]
  - Both are guides on neon.com, not reference documentation. They use custom settings, not `search_path`. `search_path` is an ordinary setting and follows the same rules [PG2]; **UNVERIFIED** by an end-to-end test against a Neon pooled endpoint in this research.

### 2.4 Prepared statements and changing `search_path`

- PgBouncer tracks protocol-level named prepared statements in transaction mode since 1.21 when `max_prepared_statements` is non-zero [PB3]; Neon sets 1000 [NE1]. SQL-level `PREPARE` is not supported through the pooler [NE1].
- PostgreSQL handles a changed search path correctly: *"if the value of search_path changes from one use to the next, the statement will be re-parsed using the new `search_path`."* [PG3] Correctness is preserved. **INFERENCE**: a server-side prepared statement shared across tenants is re-parsed and re-planned on every tenant switch, so named prepared statements bring little benefit here.

### 2.5 PostgreSQL 18 interaction

- PostgreSQL 18 reports `search_path` changes to the client [PG10]. PgBouncer tracks client-changeable parameters that Postgres reports, and lists `search_path (since PostgreSQL version 18)` among them [PB2].
- **UNVERIFIED**: how PgBouncer's parameter tracking behaves when `search_path` is changed by `SET LOCAL` and reverted at commit on PostgreSQL 18. No primary source describes this case. It must be covered by the isolation test in constraint 4, on the Postgres major version actually deployed.

### 2.6 Neon serverless driver

- HTTP: *"Querying over an HTTP fetch request is faster for single, non-interactive transactions"*; several statements can be sent with `transaction()`, which runs *"a single, non-interactive transaction"* [NE2].
- Neon's own documentation shows a transaction-local setting as the first statement of an HTTP transaction [NE2]:

  ```javascript
  const [, my_table] = await sql.transaction([
    sql`SELECT set_config('request.jwt.claims', ${claims}, true)`,
    sql`SELECT * FROM my_table`,
  ]);
  ```

  The same shape works for `search_path` (**INFERENCE**; same mechanism).
- Limits of the HTTP path: no interactive transactions, so no read-decide-write logic inside one transaction [NE2]. A single HTTP query outside `transaction()` has no transaction in which to set the path.
- Drizzle's `neon-http` driver throws on `db.transaction()`: `throw new Error('No transactions support in neon-http driver')`; only `db.batch()` maps to Neon's `transaction()` [DZ6].
- WebSocket (`Pool`/`Client`): supports sessions and interactive transactions; in serverless environments *"`Pool` or `Client` objects must be connected, used and closed within a single request handler"* [NE2].
- **UNVERIFIED**: whether Neon's HTTP endpoint routes through the same PgBouncer instance as the `-pooler` hostname. It does not change the conclusion, because an HTTP transaction is a single transaction either way.
- For Vercel specifically Neon now recommends plain TCP: *"With Vercel Fluid, we recommend you use a standard Postgres TCP connection (for example, with the node-postgres package) and a connection pool"*, using `attachDatabasePool` from `@vercel/functions` with Drizzle's `node-postgres` driver [NE4]. Neon also warns against stacking a client pool on a pooled connection without releasing promptly [NE3].

### 2.7 Failure direction

- PostgreSQL resolves unqualified names by walking the search path; the first schema in the path is where new objects are created [PG4].
- **INFERENCE**: if the tenant path is ever not set (statement outside a transaction, forgotten wrapper), queries fall back to the role's default path. If that default contains no schema with tenant-shaped tables, the query fails with "relation does not exist" rather than reading another tenant. That makes the design fail closed, provided `public` stays empty of tenant tables and no tenant schema is ever in a role default.
- Security note from the PostgreSQL manual: *"adding a schema to `search_path` effectively trusts all users having `CREATE` privilege on that schema."* [PG4]

---

## 3. Drizzle and a schema chosen at runtime

### 3.1 No native support

- `pgSchema("name")` binds tables to a fixed schema name and the query builder emits schema-qualified SQL [DZ1]. The schema name is fixed when the table object is created.
- Feature request "Dynamic Schema" (#1807, opened 2024-01-17) is still open. The only maintainer comment is a batch status update from 2025-08-30 that does not address the request [DZ3].
- Issue #423 "working with dynamic schemas is practically impossible" (opened 2023-04-09) is still open. A maintainer suggested a table factory, `pgSchema(schemaName).table('users', {...})` per tenant [DZ4]. Users in #1807 report that factories break down with relations, circular references and drizzle-kit [DZ3].
- Several commenters in #1807 state they moved to Kysely because of this gap [DZ3].

### 3.2 The approach that fits the ADR

- Define tenant tables with plain `pgTable` (no schema). Drizzle then emits unqualified names, which PostgreSQL resolves through the search path [DZ1][PG4]. Define control tables with `pgSchema('control')`, which are always emitted qualified [DZ1]. Table definitions stay static, so types, relations and the relational query API are unaffected. **INFERENCE** from the documented behaviour; it is also the workaround users describe in #1807 and #908 [DZ3][DZ5].
- Every tenant-scoped access must run inside `db.transaction()` with `set_config('search_path', ..., true)` as its first statement, as in Neon's guide [NE5].
- The `neon-http` driver cannot do this with `db.transaction()` [DZ6]. `node-postgres` and `neon-serverless` (WebSocket) can.

### 3.3 drizzle-kit and migrations across N schemas

- `drizzle-kit migrate` and the `migrate()` function record applied migrations in one table, default `__drizzle_migrations` in schema `drizzle` [DZ2]. `migrate()` accepts `migrationsTable` and `migrationsSchema` [DZ7].
- `schemaFilter` (which accepts globs such as `"tenant_*"`) applies to `push` and `pull` only, not to `migrate` [DZ2].
- A request for a target schema option on `migrate()` (#908, opened 2023-07-18) is still open [DZ5]. A contributor describes the working method: generated migrations are schema-less, so set the search path on the connection and keep a migrations table per schema [DZ5].
- Stable `migrate()` (0.45.3) behaviour from source [DZ7]:
  - it compares only against the newest recorded migration (`order by created_at desc limit 1`) and applies every local migration with a later timestamp;
  - it runs **all** pending migrations inside **one** transaction;
  - it does not set `search_path`; unqualified DDL lands wherever the connection's path points.
- v1 release candidate: the migration folder layout changed and the old layout is rejected with *"You must upgrade drizzle-kit and run "drizzle-kit up""*; the migrations table gains `name` and `applied_at` columns; pending migrations are selected by comparing the full list and still run in one transaction [DZ8].
- The `neon-http` migrator is not transactional: *"The Neon HTTP driver does not support transactions. This means that if any part of a migration fails, no rollback will be executed."* [DZ9]

### 3.4 Known pitfalls

1. **Hard-coded `"public"` in generated foreign keys.** drizzle-kit 0.30.6 generated `... FOREIGN KEY ("userId") REFERENCES "public"."users"("id")` for tables declared with plain `pgTable` (#4369) [DZ10]. In the stable generator the foreign-key target schema falls back to `'public'` (`fk.schemaTo || 'public'`) [DZ11]. Under a tenant search path such a statement either fails or, worse, links to a table in `public`. A maintainer closed #4369 on 2026-01-03 stating it is fixed in the v1 beta line [DZ10]. Users report hand-editing generated SQL to remove `"public".` [DZ4][DZ10]. **UNVERIFIED**: I did not generate a migration with 1.0.0-rc to confirm the output.
2. **v1 migrate and search path.** Open issue #5889 (2026-06-13, reproduced by the reporter on 1.0.0-rc.3): when `migrations.schema` equals the database user name, `drizzle-kit migrate` creates user tables in that schema instead of `public`. A commenter attributes it to the migrator changing `search_path`; that analysis is not confirmed by a maintainer [DZ12]. It shows that drizzle-kit's own handling of the search path during migration is not settled.
3. **One transaction for all pending migrations** [DZ7][DZ8] rules out `CREATE INDEX CONCURRENTLY` inside Drizzle's migrator, because it *"cannot"* run in a transaction block [PG8].
4. **Enums and other types.** With `pgTable`/`pgEnum` and no schema, generated `CREATE TYPE` is unqualified and lands in the tenant schema through the search path. **INFERENCE**; consistent with how Drizzle qualifies only `pgSchema` entities [DZ1]. It multiplies `pg_type` rows per tenant (already visible in the measurement: `pg_type` 15 MB).
5. **Better Auth** generates Drizzle tables; its tables belong in the control schema and need `pgSchema` support from its generator. A related request exists in the Better Auth tracker (#6606) [BA1]. **UNVERIFIED**: its current state; the issue was seen in search results and not read.

---

## 4. Migration duration and failure handling across several hundred schemas

### 4.1 Building blocks from PostgreSQL

- DDL is transactional. **MEASURED**: a migration of seven statements that failed at its third statement in one tenant left that tenant with none of the changes applied.
- `ALTER TABLE` takes an `ACCESS EXCLUSIVE` lock *"unless explicitly noted"* [PG9]. The lock is on one tenant's table, so a blocked migration stalls one tenant, not all. **INFERENCE**.
- Adding a column with a non-volatile default does not rewrite the table, *"making the `ALTER TABLE` very fast even on large tables"* [PG9].
- `CREATE INDEX CONCURRENTLY` cannot run in a transaction block and on failure leaves an *"invalid"* index behind [PG8].
- Migrations must use a direct connection: Neon lists "Schema migrations (Prisma Migrate, Drizzle Kit, django-admin migrate)" and `CREATE INDEX CONCURRENTLY` under direct connections [NE3].

### 4.2 Duration

- **MEASURED** (stock Postgres, loopback, empty tables, one new connection and one transaction per tenant, sequential): a migration with five `ADD COLUMN`, one `CREATE TABLE` with a foreign key and one `CREATE INDEX`, plus the version update in the control schema, ran at **about 28 ms per tenant**: 149 tenants in 4.4 s, 151 tenants in 4.1 s.
- **MEASURED**: creating a full tenant schema (100 tables, 300 indexes) took 0.19-0.25 s per tenant, rising slightly as the catalog grew (18.7 s for tenants 11-100, 24.8 s for tenants 201-300). Dropping one tenant schema took 0.4 s.
- **UNVERIFIED** on Neon. Expect network round trips per statement, TLS connection setup per tenant, and Neon's storage layer handling relation creation more slowly than local disk (section 1.3). An honest planning figure needs a measurement on a Neon branch at target scale.
- Duration grows linearly with tenants (as ADR 0006 already states). Data-dependent steps (index builds, backfills) scale with each tenant's row counts instead, and dominate for large properties. **INFERENCE**.

### 4.3 Failure handling

- **MEASURED**: with stop-on-first-failure, an injected conflict in tenant 150 left 149 tenants on version 2, 151 on version 1, and tenant 150 untouched. After fixing the cause, re-running the same script migrated the remaining 151. The version column in the control schema was updated in the same transaction as the DDL, so it never disagreed with the schema.
- **INFERENCE**: a stopped roll-forward leaves the fleet on two schema versions for as long as the fix takes. That is only safe if both the previous and the new application release work against both versions, which is what the expand/contract rule in ADR 0006 provides. The spec should state the consequence: a contract step may ship only after every tenant has reached the expand version.
- Drizzle's stable migrator applies all pending migrations in a single transaction per call [DZ7]. Called once per tenant this gives per-tenant atomicity across several pending migration files. Its bookkeeping table would need to live per tenant (`migrationsSchema` = tenant schema) [DZ5][DZ7]; the ADR's requirement to record the version in the control schema then needs a second write, or a custom runner that applies drizzle-kit's generated SQL files itself.
- Provisioning a new tenant and migrating existing tenants are the same code path run against an empty schema. **INFERENCE**.

---

## 5. LISTEN/NOTIFY on Neon

### 5.1 Works on direct connections only

- PgBouncer: `LISTEN` is "Never" compatible with transaction pooling; `NOTIFY` is listed as compatible [PB1].
- Neon lists `LISTEN` / `NOTIFY` together as *"Not supported with pooled connections"* [NE1] and says to use direct connections for `LISTEN / NOTIFY` [NE3].
- **UNVERIFIED**: whether `NOTIFY` / `pg_notify()` issued through Neon's pooled endpoint is delivered. PgBouncer says it works [PB1]; Neon's list says unsupported without separating the two [NE1]. The staff app would send notifications from pooled connections, so this needs a test. A notification raised by a trigger runs inside the writing transaction on the server and is the same mechanism.

### 5.2 Limits in PostgreSQL

- Payload: *"In the default configuration it must be shorter than 8000 bytes."* [PG14]
- Queue: 8 GB in a standard installation; *"If this queue becomes full, transactions calling `NOTIFY` will fail at commit."* A listener that sits in a long transaction blocks cleanup [PG14].
- Delivery happens only on commit; identical channel-plus-payload pairs within one transaction are folded into one [PG14].
- Channels are per database, and *"Notifications are visible to all users."* [PG14] Any role that can connect can listen on any channel, so a payload is visible across tenants at the database level.
- Registrations are per session: *"A session's listen registrations are automatically cleared when the session ends."* [PG15] There is no replay; anything sent while the listener is disconnected is lost.
- Commits that contain a `NOTIFY` are serialised across the whole cluster by a heavyweight lock: *"Because all writers serialize on a cluster-wide heavyweight lock"* and *"The lock is on "database 0""* (PostgreSQL source, `async.c`) [PG16]. At hotel front-desk volumes this is unlikely to matter; it is a ceiling to know about. **INFERENCE** on the volume judgement.

### 5.3 Limits added by Neon

- *"notifications and listeners defined using NOTIFY/LISTEN commands only exist for the duration of the current session and are lost when the session ends. To avoid losing session-level contexts in Neon, you can disable Neon's Scale to Zero feature, which is possible on any of Neon's paid plans. However, disabling scale to zero also means that your compute will run 24/7."* [NE7]
- Default suspension: *"If there are no active queries for 5 minutes ... your compute is automatically placed into an idle state."* [NE20] An idle listening connection does not count as an active query. **INFERENCE** from that wording.
- Even with scale to zero disabled: *"Listeners are still terminated when the compute restarts, so your listener should reconnect and re-run `LISTEN`, and it may miss messages sent while it was disconnected."* [NE21]
- Direct connections count against `max_connections`, which depends on compute size: 104 at 0.25 CU, 419 at 1 CU, 839 at 2 CU [NE1]. One listener connection for the worker is negligible.

### 5.4 Consequence for the design in ticket 08

One listening connection in the always-on worker feeding Server-Sent Events fits these limits, if notifications are treated as a wake-up signal and not as the data. **INFERENCE**. The worker's job queue polls every few seconds (section 6), so the compute will not suspend in practice; scale to zero should be switched off deliberately so that cost and behaviour are predictable.

---

## 6. pg-boss and Graphile Worker with one shared queue schema

### 6.1 pg-boss (12.x)

- Installs into its own schema, default `pgboss`, configurable with `schema`; creates it automatically given the `CREATE` privilege [PB-B1][PB-B2]. Installing into an existing schema is *"supported for advanced use cases but discouraged"* [PB-B2].
- Its SQL is built with the schema name interpolated throughout (322 occurrences of `${schema}.` in `src/plans.ts`, no reference to `search_path`) [PB-B5]. **INFERENCE**: it does not depend on the connection's search path and is unaffected by tenant paths.
- Based on `SKIP LOCKED` polling [PB-B3]. `LISTEN/NOTIFY` is optional (`useListenNotify`, default false), holds one dedicated connection, and works *"not through PgBouncer in transaction or statement pooling mode"*; polling remains as fallback [PB-B1].
- Transactional enqueue from application code: `send()`, `insert()`, `fetch()`, `complete()` accept a `db` option; a Drizzle adapter exists: `boss.send('order-processing', {...}, { db: fromDrizzle(tx, sql) })`, supported for the `node-postgres`, `postgres-js` and `bun-sql` drivers [PB-B4]. A job enqueued inside the tenant transaction commits or rolls back with the tenant's write. This covers the transactional outbox for channel-manager updates named in ticket 08. **INFERENCE** for the last sentence.
- Storage is one partitioned `job` table; a queue created with `partition` gets its own physical table [PB-B3]. One partitioned queue per tenant would add hundreds of tables. **INFERENCE**.
- Default pool size 10 connections per instance [PB-B1].

### 6.2 Graphile Worker (0.18)

- Installs into schema `graphile_worker`, configurable with `schema` [GW1][GW2]. Requires PostgreSQL 12+ and Node 22.18+ [GW3]. Expects to run as the database owner role; restricted roles need manual setup [GW1].
- Jobs can be added from SQL with `graphile_worker.add_job(...)`, a schema-qualified function callable from any transaction, trigger or function [GW4]. Called inside the tenant transaction it is atomic with the tenant's write. **INFERENCE**.
- Uses `LISTEN/NOTIFY` by default, plus polling (`pollInterval` default 2000 ms) for scheduled and retried jobs. Its FAQ says PgBouncer *"might pose an issue if it's not done in "connection" mode"* and that there is currently no option to turn listening off [GW5]. The worker must therefore use a direct connection.
- The tables are private API: *"Do not use the various tables ... directly"*; reading the jobs table inside a transaction can cause jobs to be skipped [GW1].
- `queue_name`: *"Avoid using high cardinality values"* [GW4]. One named queue per tenant (a few hundred values) for serialised per-tenant work is moderate cardinality; **UNVERIFIED** where the practical limit lies.
- The jobs table has high churn and needs vacuuming [GW6]. Default pool size 10 [GW2].

### 6.3 Shared by both

- Both keep one queue for all tenants in one schema beside the tenant schemas. Neither has any notion of tenant. The tenant identifier must travel in the job payload, and the job handler must open its own transaction and set the search path, exactly as a web request does. **INFERENCE**.
- A handler that forgets to set the path fails closed if the worker role's default path holds no tenant tables (section 2.7). **INFERENCE**.
- Queue rows sit outside the tenant schema. `pg_dump -n <tenant>`, tenant restore and tenant deletion do not include queued jobs or job history [PG5]. **INFERENCE**: payloads should carry identifiers only, so that no guest data lives outside the tenant schema and the isolation story of ADR 0006 holds.
- Both workers need direct connections (polling is fine through a pooler, listening is not) [PB-B1][GW5][NE3]. Ticket 08 already assigns direct connections to the worker.
- Neither choice is blocked by schema-per-tenant. pg-boss has a documented Drizzle transaction adapter and can run without `LISTEN`; Graphile Worker has the SQL-level `add_job` and always listens.

---

## Verdict

**Feasible with named constraints.**

- The tenant-routing mechanism is sound. Transaction-scoped `search_path` is safe through PgBouncer transaction mode by PostgreSQL's and PgBouncer's documented semantics [PG2][PB1], Neon publishes the pattern itself [NE5][NE2], and Drizzle works with it using static unqualified table definitions [DZ1].
- The mechanism excludes two things the ticket-08 answer leaves open: Drizzle's `neon-http` driver for tenant data [DZ6], and any session-level `SET` on pooled connections [PB2].
- Drizzle has no first-class support. The project owns a small tenant-transaction wrapper and a migration runner, and must guard generated SQL against `"public".` references [DZ10][DZ11].
- The open risk is Neon at 200,000+ relations. Neon's engineers described trouble beyond about 10,000 relations in late 2024 and shipped a redesign in 2025 whose production rollout is not publicly confirmed [NE14][NE15]. Neon's documentation advises against schema-per-tenant [NE8]. Stock PostgreSQL handled 210,000 relations without difficulty in the local measurement, apart from the lock-table limit on whole-database dumps.
- Nothing found makes the approach inadvisable at a few hundred tenants. The Neon relation-count question has to be settled by a load test on Neon before build start, and the spec should name the fallback if it fails (another managed Postgres in the EU, or fewer relations per tenant).

Confidence: high for sections 2, 3, 5 and 6 (documented behaviour, source code). Medium for sections 1 and 4 on Neon, because the decisive numbers are local measurements and Neon publishes none.

## Constraints the spec must state

1. **Tenant access only inside an explicit transaction.** Every read or write of tenant data runs inside a transaction whose first statement is `select set_config('search_path', <tenant schema>, true)` (or `SET LOCAL search_path`). No tenant query may run outside that wrapper. One shared function in `packages/db` owns this; application code cannot obtain a tenant-capable database handle any other way.
2. **No session-level `SET` on pooled connections, ever**, and no `ALTER ROLE ... SET search_path` naming a tenant schema. Add a lint or test that rejects `SET search_path` without `LOCAL` in application code.
3. **Driver choice.** Apps on Vercel connect with Drizzle `node-postgres` over TCP to the pooled endpoint using `attachDatabasePool`, or with `neon-serverless` over WebSocket. Drizzle `neon-http` is not used for tenant data.
4. **Isolation test on the real pooler.** An automated test runs concurrent requests for at least two tenants through the Neon pooled endpoint, on the deployed Postgres major version, and asserts that neither sees the other's rows. It runs in CI against a Neon branch. This covers the unverified PostgreSQL 18 parameter-tracking case.
5. **Fail closed.** The `public` schema holds no tables. Application and worker roles have a default `search_path` that contains no tenant schema. Tenant schema names come only from the control schema, never from request input, and match a fixed pattern of at most 63 bytes.
6. **Table definitions.** Tenant tables are declared with `pgTable` (unqualified). Control tables are declared with `pgSchema('control')`. No table factories per tenant.
7. **Self-contained tenant schemas.** No foreign keys, types, functions or sequences shared between a tenant schema and any other schema. References to users in the control schema are stored as plain ids without a database foreign key. This keeps `pg_dump -n <tenant>` restorable.
8. **Generated SQL is checked.** CI fails if a generated tenant migration contains a schema-qualified name (`"public".` or any other). Pin drizzle-kit to a version whose output passes this check.
9. **Migration runner.** A project-owned runner rolls tenants forward over a **direct** connection, one transaction per tenant, with `lock_timeout` set, writing the tenant's version to the control schema inside the same transaction. It stops on the first failure and is safe to re-run. New-tenant provisioning uses the same runner.
10. **Expand/contract with a gate.** A contract migration may ship only when the control schema shows every tenant at the expand version. The application tolerates tenants on the previous and the new version at the same time.
11. **Long-running DDL is separate.** Index builds on large tables use `CREATE INDEX CONCURRENTLY` in a separate, non-transactional runner step with detection and cleanup of invalid indexes. Backfills run as background jobs per tenant.
12. **Relation budget.** Track relations per tenant as a number (target: state one; the measurement gave about 700 for 100 tables). Prefer uuid keys over identity or serial columns where a sequence is not needed, and review every index. Alert on total `pg_class` row count.
13. **Neon load test before build start.** On a Neon branch in eu-central-1 create the target fleet (at least 300 schemas at the planned table count) and record: provisioning time, migration roll-forward time, branch creation time, compute cold-start time, `pg_dump -n` time, whole-database dump result, autovacuum behaviour. Ask Neon support to confirm the reldir v2 status and the values of `max_locks_per_transaction`, `autovacuum_max_workers` and PgBouncer `server_lifetime` for the project. Record the results in this file. Name the fallback provider if the test fails.
14. **Backups are per tenant.** Export and restore use `pg_dump -n <tenant>` / `pg_restore` over a direct connection. A single tenant's point-in-time restore is done by branching at that time, dumping the tenant from the branch and restoring into production. Neon's instant restore is reserved for whole-fleet disasters because it rewinds every tenant. Whole-database dumps are not relied on.
15. **Compute is always on.** Scale to zero is disabled on the production compute. Size the compute for backend cache growth (section 1.6), and keep the number of pooled server connections low.
16. **Notifications are hints.** `NOTIFY` payloads carry a tenant id, an event type and entity ids only, never guest data, and stay under 8000 bytes. The worker holds one listening direct connection, reconnects and re-issues `LISTEN` on loss, and SSE clients re-fetch current state after any reconnect. Whether `NOTIFY` may be sent through the pooled endpoint is decided by a test; until then notifications originate from triggers or from the worker.
17. **One shared queue schema.** The job queue lives in its own schema, used over direct connections by the worker. Every job payload carries the tenant id and identifiers only. Every job handler goes through the wrapper of constraint 1. Jobs that must be atomic with a tenant write are enqueued inside the tenant transaction (pg-boss `db` adapter or `graphile_worker.add_job`). No per-tenant queue tables.
18. **Tenant deletion and export cover data outside the schema**: control-schema rows, queued jobs and files in object storage are handled by explicit steps, because dropping or dumping the schema does not touch them.

---

## Appendix: local measurement method

Throwaway cluster, PostgreSQL 16.14 (Homebrew) on macOS, Apple Silicon, 8 cores, 8 GB RAM; `shared_buffers = 128MB`, `max_locks_per_transaction = 64`, `max_connections = 100` (raised to 839 for the second whole-database dump); `fsync = on`; TCP loopback. Created and deleted within this research session; nothing was installed and the project directory was not touched.

- Tenant schema: 100 tables `t001`..`t100`, each `id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`, `property_id uuid`, `code text`, `status text`, `payload jsonb`, `amount numeric(12,2)`, two `timestamptz`, a foreign key to the previous table, one composite index and one unique composite index.
- Provisioning: one `psql` process and one transaction per tenant (`BEGIN; CREATE SCHEMA; SET LOCAL search_path; 300 DDL statements; COMMIT`).
- Migration: five `ALTER TABLE ... ADD COLUMN`, one `CREATE TABLE` with foreign key, one `CREATE INDEX`, one `UPDATE control.tenants`, in one transaction per tenant with `SET LOCAL lock_timeout = '5s'`, sequential, stop on first error. Failure injected by pre-creating one of the columns in tenant 150.
- Cache growth: one session running `select count(*)` on 40 tables in each of 300 tenants, reading `pg_backend_memory_contexts`.
- All tables were empty. Figures say nothing about data-dependent costs.

| Measurement | Result |
|---|---|
| Relations after 300 tenants x 100 tables | 210,413 |
| Database size, no rows | 1,697 MB |
| Provision one tenant | 0.19-0.25 s |
| Migrate one tenant (7 DDL statements) | about 28 ms |
| Roll-forward of 300 tenants | about 8.5 s in total |
| `pg_dump -n` one tenant | 1.6 s, 176 MB client memory |
| `pg_dump -s` whole database, lock table 64 x 100 | failed, out of shared memory |
| `pg_dump -s` whole database, lock table 64 x 839 | 7.5 s, 455 MB client memory |
| Backend memory after touching 12,000 tables | 232 MB |
| `VACUUM (ANALYZE)` whole database | 23 s |
| `DROP SCHEMA ... CASCADE` one tenant | 0.4 s |

## Sources

PostgreSQL
- [PG1] https://www.postgresql.org/docs/current/limits.html — Appendix K, relations per database, identifier length.
- [PG2] https://www.postgresql.org/docs/current/sql-set.html — `SET`, `SET LOCAL`, `set_config`.
- [PG3] https://www.postgresql.org/docs/current/sql-prepare.html — re-parse when `search_path` changes.
- [PG4] https://www.postgresql.org/docs/current/ddl-schemas.html — search path resolution, creation schema, security note.
- [PG5] https://www.postgresql.org/docs/current/app-pgdump.html — `-n`, `-j`, locks.
- [PG6] https://www.postgresql.org/docs/current/runtime-config-locks.html — `max_locks_per_transaction`.
- [PG7] https://www.postgresql.org/docs/current/routine-vacuuming.html — autovacuum daemon, statistics dependency, wraparound.
- [PG8] https://www.postgresql.org/docs/current/sql-createindex.html — `CONCURRENTLY` restrictions.
- [PG9] https://www.postgresql.org/docs/current/sql-altertable.html — lock level, fast `ADD COLUMN` with default.
- [PG10] https://www.postgresql.org/docs/18/release-18.html — "Report search_path changes to the client".
- [PG11] https://www.postgresql.org/message-id/15093.1586915311@sss.pgh.pa.us — Tom Lane, 2020-04-15, reply to BUG #16363, per-table cache memory.
- [PG12] https://www.postgresql.org/message-id/20160613093907.GA10381%40depesz.com — 2016-06-13, about 32 kB cache per table, `server_lifetime`.
- [PG13] https://postgrespro.com/list/thread-id/2064050 — archive of the 2012 pgsql thread "pg_dump and thousands of schemas" (mirror of the postgresql.org list).
- [PG14] https://www.postgresql.org/docs/current/sql-notify.html — payload, queue, delivery semantics, visibility.
- [PG15] https://www.postgresql.org/docs/current/sql-listen.html — session scope of `LISTEN`.
- [PG16] https://github.com/postgres/postgres/blob/master/src/backend/commands/async.c — source comments on the cluster-wide lock taken at commit by notifying transactions.

PgBouncer
- [PB1] https://www.pgbouncer.org/features.html — pooling modes, feature compatibility table.
- [PB2] https://www.pgbouncer.org/config.html — `server_reset_query`, `server_reset_query_always`, `server_lifetime`, `server_idle_timeout`, `track_extra_parameters`, `max_prepared_statements`.
- [PB3] https://www.pgbouncer.org/faq.html — prepared statements in transaction pooling since 1.21.

Neon
- [NE1] https://neon.com/docs/connect/connection-pooling — transaction mode, unsupported features, `SET search_path` issue, PgBouncer settings, `max_connections` per compute size, pg_dump.
- [NE2] https://neon.com/docs/serverless/serverless-driver — HTTP vs WebSocket, `transaction()`, `set_config` example, Pool/Client rules.
- [NE3] https://neon.com/docs/connect/choose-connection — pooled vs direct, migrations, LISTEN/NOTIFY, double pooling.
- [NE4] https://neon.com/docs/guides/vercel-connection-methods — TCP with `attachDatabasePool` on Vercel Fluid.
- [NE5] https://github.com/neondatabase/website/blob/main/content/guides/test-rls-on-neon-branches.md — guide (created 2026-07-02), "Connection pooling and the SET LOCAL trap".
- [NE6] https://github.com/neondatabase/website/blob/main/content/guides/clip-image-search.md — guide, `SET LOCAL` inside the same transaction on pooled connections.
- [NE7] https://neon.com/docs/reference/compatibility — session context, statistics not saved on suspend, parameter table, no user-set instance parameters.
- [NE8] https://neon.com/docs/guides/multitenancy — project-per-tenant recommendation, position on schema-per-tenant.
- [NE9] https://neon.com/docs/introduction/plans — projects, branches, history window, scale to zero per plan, storage price.
- [NE10] https://neon.com/docs/manage/databases — 500 databases per branch; roles limit from https://neon.com/docs/manage/roles as surfaced in search (roles page not read in full).
- [NE11] https://neon.com/docs/introduction/branching — copy-on-write branches.
- [NE12] https://neon.com/docs/guides/branch-restore — restore scope is the whole branch.
- [NE13] https://neon.com/docs/postgresql/postgres-version-policy — supported Postgres versions.
- [NE14] https://github.com/neondatabase/neon/issues/9516 — "pageserver: support 1 million relations".
- [NE15] https://github.com/neondatabase/neon/issues/9855 — slow WAL ingestion with about 100,000 relations.
- [NE16] https://github.com/neondatabase/neon/issues/1910 — "Bad keyspace partitioning if you have a large schema".
- [NE17] https://github.com/neondatabase/neon/pull/10593, https://github.com/neondatabase/neon/pull/12576, https://github.com/neondatabase/neon/pull/12758 — reldir v2 implementation, rollout rework, still-open default-enable PR.
- [NE18] https://github.com/neondatabase/neon/blob/main/compute/etc/pgbouncer.ini — open-source default PgBouncer config (production values are set by the control plane and differ, see [NE1]).
- [NE19] https://github.com/neondatabase/neon/blob/main/test_runner/performance/test_perf_many_relations.py — many-relations tests set `max_locks_per_transaction=16384`.
- [NE20] https://neon.com/docs/introduction/compute-lifecycle — scale to zero after 5 minutes without active queries, session context loss.
- [NE21] https://github.com/neondatabase/website/blob/main/content/guides/pg-notify.md — guide, direct connection for `LISTEN`, listeners lost on restart.

Drizzle
- [DZ1] https://orm.drizzle.team/docs/schemas — `pgSchema`, schema-qualified SQL.
- [DZ2] https://orm.drizzle.team/docs/drizzle-config-file — `schemaFilter`, `tablesFilter`, `migrations` table and schema defaults.
- [DZ3] https://github.com/drizzle-team/drizzle-orm/issues/1807 — "[FEATURE]: Dynamic Schema", open.
- [DZ4] https://github.com/drizzle-team/drizzle-orm/issues/423 — dynamic schemas, open; maintainer's factory suggestion; user workaround removing `public` from generated migrations.
- [DZ5] https://github.com/drizzle-team/drizzle-orm/issues/908 — target schema for `migrate()`, open.
- [DZ6] https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/neon-http/session.ts — `transaction()` throws; `batch()` uses Neon `transaction()`. See also https://orm.drizzle.team/docs/connect-neon.
- [DZ7] https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/dialect.ts — stable `migrate()` (main is 0.45.3).
- [DZ8] https://github.com/drizzle-team/drizzle-orm/tree/v1.0.0-rc.4/drizzle-orm/src — `migrator.ts`, `pg-core/async/session.ts`, release-candidate migrator.
- [DZ9] https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/neon-http/migrator.ts — non-transactional migrator note.
- [DZ10] https://github.com/drizzle-team/drizzle-orm/issues/4369 — `REFERENCES "public"."users"` in generated SQL; closed 2026-01-03 as fixed in v1 beta.
- [DZ11] https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-kit/src/serializer/pgSchema.ts and `drizzle-kit/src/sqlgenerator.ts` — `fk.schemaTo || 'public'`, foreign-key statement generation.
- [DZ12] https://github.com/drizzle-team/drizzle-orm/issues/5889 — v1 `migrate` creates tables in the wrong schema, open.

pg-boss
- [PB-B1] https://github.com/timgit/pg-boss/blob/master/docs/api/constructor.md — `schema`, `db`, `max`, `useListenNotify`.
- [PB-B2] https://github.com/timgit/pg-boss/blob/master/docs/install.md — schema creation, existing-schema warning.
- [PB-B3] https://github.com/timgit/pg-boss/blob/master/docs/introduction.md — `SKIP LOCKED`, partitioned job table.
- [PB-B4] https://github.com/timgit/pg-boss/blob/master/docs/api/adapters.md — ORM transaction adapters, Drizzle.
- [PB-B5] https://github.com/timgit/pg-boss/blob/master/src/plans.ts — schema-qualified SQL.

Graphile Worker
- [GW1] https://github.com/graphile/worker/blob/main/website/docs/schema.md (published at worker.graphile.org/docs/schema) — schema, private tables, restricted roles.
- [GW2] https://github.com/graphile/worker/blob/main/website/docs/config.md — `schema`, `maxPoolSize`, `pollInterval`.
- [GW3] https://github.com/graphile/worker/blob/main/website/docs/requirements.md — PostgreSQL and Node versions.
- [GW4] https://github.com/graphile/worker/blob/main/website/docs/sql-add-job.md — `graphile_worker.add_job()`.
- [GW5] https://github.com/graphile/worker/blob/main/website/docs/faq.md — LISTEN/NOTIFY default, PgBouncer.
- [GW6] https://github.com/graphile/worker/blob/main/website/docs/scaling.md — small jobs table, vacuuming.

Other
- [BA1] https://github.com/better-auth/better-auth/issues/6606 — pgSchema support in Better Auth's Drizzle generator (title only, not read).
- [AWS1] https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.HighObjectCount.html — effects of high object counts (vendor guidance for RDS, cited for the description of catalog effects).
- [N1] https://registry.npmjs.org — dist-tags for drizzle-orm, drizzle-kit, pg-boss, graphile-worker, @neondatabase/serverless, read 2026-09-28.
