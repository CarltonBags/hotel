# 13 — Worker service: jobs, schedules, live updates and webhook intake

**What to build:** One always-on worker container runs beside the Vercel apps (ADR 0007): a Postgres-backed job queue with tenant id and identifiers only in payloads, scheduled jobs, a Server-Sent Events endpoint fed by LISTEN/NOTIFY, and an inbound webhook endpoint that stores the raw event, acknowledges, resolves the tenant through the control schema and processes it as an idempotent job keyed by event id. Handlers set the search path like any request. Demo: a scheduled job writes a notification that appears as a toast in the shell of the affected user without a reload.

**Blocked by:** 12 App shell with tabs, Main Menu, themes and languages

**Status:** ready-for-agent

- [ ] A job enqueued for tenant A runs in tenant A's schema and cannot touch tenant B
- [ ] SSE reconnects after a worker restart and the client catches up
- [ ] A webhook replayed with the same event id is processed once
- [ ] Worker runs as a container with health endpoint; deploy documented
