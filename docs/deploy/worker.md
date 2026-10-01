# Deploying the worker

The worker (`apps/worker`) is the one always-on process beside the Vercel apps (ADR 0007). It runs the job queue (pg-boss on its own `pgboss` schema), schedules, the live-update stream (`/events`, Server-Sent Events fed by Postgres LISTEN/NOTIFY) and webhook intake (`/webhooks/<source>`). It must reach Postgres over a **direct** connection, not the transaction-mode pooler.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_DIRECT_URL` | Direct Postgres connection (Neon: endpoint without `-pooler`). Falls back to `DATABASE_URL`. |
| `BETTER_AUTH_SECRET` | Shared with the staff app; signs the short-lived stream tokens. |
| `WORKER_PORT` | HTTP port, default 8080. |
| `WORKER_ALLOW_ORIGIN` | Origin pattern allowed to read the stream, e.g. `https://*.app.example` (one wildcard label; the matching request origin is echoed). Required in production; `*` only in development. |
| `TENANT_CHECK_CRON` | Cron for the demo tenant check (`* * * * *` in development, unset in production). |
| `WEBHOOK_TEST_SECRET` | Enables the `test` webhook source for smoke tests; unset in production. |

The staff app needs `NEXT_PUBLIC_WORKER_URL` pointing at the worker's public URL.

## Endpoints

- `GET /health` → `{ ok, listener, queue, streams }`, 503 while the LISTEN connection or the queue is down. The listener reconnects on its own with backoff and re-issues LISTEN; open streams re-read from their cursor afterwards.
- Stream tokens are HMAC-signed with the shared auth secret, purpose-bound, valid 10 minutes; the worker ends a stream when its token expires and the browser reopens with a fresh one and its last event id. Tokens travel in the URL, so the worker's access logs must not be shared.
- Notifications are transient staff alerts; a daily job deletes rows older than 30 days.
- `GET /events?token=…` → event stream. The browser sends `Last-Event-ID` on reconnect; the worker replays everything after it from `control.notifications`, so a worker restart loses nothing.
- `POST /webhooks/<source>` → stores the raw event, acknowledges with 202 (200 for a replay), processes it as a job keyed by `(source, external id)`.

## Container

```sh
docker build -f apps/worker/Dockerfile -t hoteloftware-worker .
docker run --rm -p 8080:8080 --env-file .env hoteloftware-worker
curl -s localhost:8080/health
```

## Hosting (EU)

Proposed: Fly.io, region `fra` (Frankfurt). The provider is a vendor decision like those in ADR 0008 (US-owned, DPA with standard contractual clauses needed); record it as an ADR when the first deployment happens., one machine now, two in ticket 94 (pg-boss is multi-master safe; SSE clients may land on either instance because replay reads the table).

```toml
# fly.toml
app = "hoteloftware-worker"
primary_region = "fra"

[build]
  dockerfile = "apps/worker/Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false      # always on
  min_machines_running = 1

[[http_service.checks]]
  path = "/health"
  interval = "30s"
  timeout = "5s"
```

Secrets: `fly secrets set DATABASE_DIRECT_URL=… BETTER_AUTH_SECRET=… WORKER_ALLOW_ORIGIN=https://*.app.example`.

Deploy pipeline order: `pnpm db:migrate` (expand steps), deploy worker, deploy apps, then contract migrations in a later release (ADR 0006).

## Smoke test after deploy

```sh
curl -s https://<worker>/health
curl -s -X POST https://<worker>/webhooks/test -H 'x-webhook-secret: …' -H 'content-type: application/json' \
  -d '{"id":"smoke-1","property":"<external id mapped in control.external_ids>"}'
```

The staff app shows a toast for every notification written to `control.notifications` for the signed-in user or their tenant.
