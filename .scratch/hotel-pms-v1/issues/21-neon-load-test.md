# Load test schema-per-tenant on Neon at target scale

Map: ../map.md
Type: task
Status: claimed
Blocked by: -

## Question

"Schema-per-tenant feasibility on Neon with Drizzle" returned "feasible with named constraints", with one open risk: 300 tenants x about 100 tables is roughly 210,000 relations, Neon engineers described trouble beyond 10,000 to 100,000 relations, and the fix's production rollout is unconfirmed. Before the spec locks the database choice, run the load test the research file specifies on a real Neon project in eu-central-1: create 300 tenant schemas of 100 tables, then measure provisioning time, roll-forward migration time across all tenants, cold-start time, branch creation time, pooled-connection behaviour with per-transaction search path, and backend memory under mixed-tenant load. Needs a Neon account and project from the owner (HITL for credentials, then AFK). Record the numbers, the verdict (keep Neon, keep schema-per-tenant on another managed Postgres, or fall back to shared schema with row-level security), and update ADR 0006 and 0008 if the verdict changes them.

## Comments

2026-09-28: offered to the owner, who chose to skip for now. Ticket stays open and unclaimed. Checklist for the owner before a session can run it:
1. Create a Neon project in region eu-central-1 (Frankfurt), Postgres 16 or newer. A paid plan may be needed: the test creates about 210,000 relations.
2. Save both connection strings to `/Users/carltonbags/Hoteloftware/.env.neon-loadtest`, never committed:
   `NEON_DIRECT_URL=...` and `NEON_POOLED_URL=...`
3. Run `/wayfinder .scratch/hotel-pms-v1/map.md 21-neon-load-test`.
The test plan is in `docs/research/schema-per-tenant-feasibility.md`.

Added 2026-09-30: also verify standby with automatic switch-over in the EU region and the time a switch-over takes, against the 99.95 % promise in "Support and service levels".

## Comments

2026-09-30: stage 1 run by the agent on the owner's Neon project (region eu-central-1, PostgreSQL 18.6, branch linked to the pooled endpoint the owner supplied). Connection strings stored in the git-ignored `.env.neon-loadtest`. The owner pasted the password into the chat; it should be reset after the test.

**Stage 1: 20 tenants x 100 tables** (schemas `lt_0000` to `lt_0019`, 425 relations per tenant, 12,963 relations in total)
| Measurement | Result |
|---|---|
| Provision one tenant (100 tables, indexes, keys) over the direct connection | 3.57 s average |
| Roll one migration (7 statements) across 20 tenants, stop on first failure | 2.9 s total, 0.15 s per tenant |
| 8 parallel clients x 25 transactions through the pooler, each setting the search path per transaction only | 0 wrong results, 0 leaked search paths, 0 foreign rows |
| Backend memory after touching 800 tables in one session | 26 MB |
| Database size | 108 MB, about 5 MB per tenant |
| LISTEN/NOTIFY on the direct connection | works |
| NOTIFY sent through the pooler, received by a direct listener | works |

**Extrapolation to 300 tenants** (not yet measured): about 1.6 GB storage, about 128,000 relations, provisioning about 18 minutes, one migration across all tenants about 45 seconds.

**Not measured**: stage 2 at 300 tenants, standby switch-over time, cold start and branch creation time (these need the Neon console or its management interface). `pg_dump` not run: the local client is version 16 and cannot dump a version 18 server.

Stage 2 waits for the owner, because 1.6 GB exceeds a free Neon plan's storage.

2026-09-30, stage 2: the owner confirmed the plan allowed about 1.6 GB, but the project stopped at **tenant 97** with "project size limit (512 MB) has been exceeded". The project is on a plan with a 512 MB limit.
| Measurement | Result |
|---|---|
| 50 tenants | 31,733 relations, 255 MB |
| Limit reached | tenant 97, about 41,000 relations, 512 MB |
| Storage per tenant | about 5.3 MB empty, consistent with stage 1 and the research |
| One tenant transaction through the pooler with 97 tenants present | 0.22 s |
The migration run and the memory reading after the limit are invalid (the full disk made the first statement fail) and are not reported. All 97 test schemas were dropped; the database is back to 463 relations and its original schemas.

**Verdict so far**: up to 97 tenants and about 41,000 relations nothing degraded: provisioning, migration, pooled isolation and notifications all behaved. The 300-tenant question (about 128,000 relations) and standby switch-over remain **unanswered**. Finishing needs a Neon plan with at least 2 GB storage, and the switch-over test needs the Neon console. The ticket stays open.
