---
status: accepted
---

# An always-on worker service runs beside the serverless apps

The Next.js apps run on Vercel, but background jobs, schedules, the Server-Sent Events endpoint and inbound webhooks run in one always-on worker container on an EU host, using a Postgres-backed queue and LISTEN/NOTIFY. We chose this over managed job and realtime services because channel-manager updates must be written transactionally with the business change (outbox), long-lived connections do not fit serverless functions, and job payloads containing guest data stay inside our own database.
