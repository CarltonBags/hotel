# 13 — Worker service: jobs, schedules, live updates and webhook intake

**What to build:** One always-on worker container runs beside the Vercel apps (ADR 0007): a Postgres-backed job queue with tenant id and identifiers only in payloads, scheduled jobs, a Server-Sent Events endpoint fed by LISTEN/NOTIFY, and an inbound webhook endpoint that stores the raw event, acknowledges, resolves the tenant through the control schema and processes it as an idempotent job keyed by event id. Handlers set the search path like any request. Demo: a scheduled job writes a notification that appears as a toast in the shell of the affected user without a reload.

**Blocked by:** 12 App shell with tabs, Main Menu, themes and languages

**Status:** done

- [x] A job enqueued for tenant A runs in tenant A's schema and cannot touch tenant B
- [x] SSE reconnects after a worker restart and the client catches up
- [x] A webhook replayed with the same event id is processed once
- [x] Worker runs as a container with health endpoint; deploy documented

## Comments

2026-10-01: built and reviewed. The worker (apps/worker) runs pg-boss 10 on its own `pgboss` schema (pg-boss 12 needs Node 22; the repo and CI are on Node 20), scheduled jobs, the Server-Sent Events endpoint fed by LISTEN/NOTIFY on a direct connection with automatic reconnect, and webhook intake. Shared pieces live in packages/events (signed stream tokens, notification publish/replay) and control migration 0005 (notifications, webhook_events, external_ids).

Acceptance, as proven:
- Tenant-scoped jobs: runTenantJob resolves the tenant from the control schema and runs the handler inside withTenant; the pg-boss integration test shows a real tenant.check job writing its notification from inside the tenant's schema. Isolation is the search path plus the CI lint; a schema-qualified name is not blocked by the database itself.
- SSE catch-up: subscribe first, then replay from Last-Event-ID in a loop; the test stops the server, publishes while it is down, restarts and receives exactly the missed rows. A first connection starts at the newest id (no history replay). The stream ends when its 10-minute token expires and the browser reopens with a fresh token and its last id.
- Webhook replay: stored row and job commit in one transaction (pg-boss db option); (source, external id) is unique, so a replay answers 200 duplicate and never enqueues again; the job marks the event processed, or failed only after the last retry.
- Container and deploy: Dockerfile (tsx at runtime) and docs/deploy/worker.md (env, endpoints, Fly.io Frankfurt proposal, smoke test). The Docker daemon was not running on the dev machine, so the image build is unverified. Hosting provider to be recorded as an ADR at first deployment.
- Demo: with TENANT_CHECK_CRON set, the browser walkthrough shows the scheduled job's toast in the shell without a reload, and the webhook endpoint accepts, deduplicates and rejects unsigned events over HTTP.

Review findings fixed: missed-event window between catch-up and subscribe, CORS by origin pattern (wildcard subdomain echoed, no `*` default in production), listener reconnect, atomic intake, token purpose prefix and expiry-bound streams, queue health from pg-boss, notification pruning after 30 days, Drizzle declarations for the new control tables, direct connection required in production, shutdown timeout.

Notes for later tickets: webhook sources register a processor per source name (startQueue options.processors); notification kinds and a notification list in the shell come with ticket 39 (staff alerts); the glossary gained "Notification" (Benachrichtigung).
