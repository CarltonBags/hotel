# Tech stack detail and tenancy strategy

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 01

## Question

Given Next.js, TypeScript, Tailwind and Postgres are fixed: decide ORM (Drizzle vs Prisma), auth (Auth.js, Clerk, Lucia, custom), multi-tenant data strategy (row-level tenant_id with RLS vs schema per tenant), hosting and Postgres provider, background jobs and scheduling (channel sync, notifications), realtime updates for the front desk (websocket vs polling), monorepo layout for staff app, booking engine, guest portal and kiosk, and how the guest-facing tablet for Meldeschein signing pairs with a front-desk session. Record the trade-offs as ADRs where hard to reverse.

## Answer

Resolved 2026-09-28 by grilling.

- **Tenancy in Postgres**: one schema per tenant holding all hotel business data, plus one shared **control schema** holding tenants, users, sessions, tenant and property role assignments, subscription, enrolled devices, and the mappings from external ids (Channex property id, Stripe account id) to tenant and property. Chosen by the product owner over shared-schema row-level security.
- **Tenant resolution**: staff app served at `<tenant>.<app-domain>`; the subdomain selects the tenant before login. Requests run inside a transaction that sets the schema search path for that transaction only, so pooled connections never leak a tenant.
- **Migrations**: the deploy pipeline rolls every tenant schema forward, records the version per tenant in the control schema, and stops on the first failure. Every migration is expand/contract so the previous release runs against the new schema during rollout.
- **Data access**: Drizzle ORM, SQL migrations.
- **Auth**: Better Auth, self-hosted, tables in the control schema. Email + password, passkeys and 2FA available; SSO is a later plugin.
- **Hosting**: Next.js apps on Vercel, EU region (Frankfurt functions). Postgres on Neon, eu-central-1: pooled connections in transaction mode for the apps, direct connections for the worker. US-owned vendors, so a DPA with SCCs is required and "EU-owned hosting" is not a sales claim in v1.
- **Worker service**: one always-on container on an EU host (provider chosen at build start) running the Postgres-backed job queue (pg-boss or Graphile Worker, picked at build start), schedules, the Server-Sent Events endpoint fed by Postgres LISTEN/NOTIFY, and the inbound webhook endpoint. Channel-manager ARI updates use a transactional outbox.
- **Webhooks** (Channex, Stripe, email): received by the worker, stored raw, acknowledged, tenant resolved from the payload via the control schema, then processed as an idempotent job keyed by event id.
- **Realtime**: Server-Sent Events, one-way push, for new bookings, room status, Guest Inbox and tablet progress.
- **Repo**: pnpm + Turborepo monorepo. `apps/staff`, `apps/booking`, `apps/guest` (portal, kiosk, tablet), `apps/worker`; `packages/domain`, `packages/db`, `packages/ui`. Guest-facing apps carry no staff code and deploy separately.
- **Tablet pairing**: an iPad is enrolled once as a **Device** of one property (QR from the staff app, long-lived device token, no staff login on the tablet). It idles until the front desk pushes a reservation's form to a chosen device and can show only what was pushed.
- **Files**: S3-compatible bucket under EU jurisdiction, per-tenant prefix, server-side encryption, access only through short-lived signed URLs, retention enforced by scheduled jobs.
- Open risk, ticketed as "Schema-per-tenant feasibility on Neon with Drizzle": schema count limits, pooler behaviour and migration time at several hundred tenants.
- ADRs: `docs/adr/0006-schema-per-tenant-with-control-schema.md`, `docs/adr/0007-always-on-worker-beside-vercel.md`, `docs/adr/0008-platform-vendors.md`.

> Update 2026-09-29: "Housekeeper and maintenance phone view prototype" requires the floor staff phone view to work offline (local storage of the day's tasks, queued changes with photos, conflict rule) and to be installable on the home screen. This adds an offline-capable web app to the staff app and a right-to-left layout for Arabic.

> Update 2026-09-29 from "Shared-device login for floor staff": authentication must support users without email and PIN Sign-in bound to enrolled Devices, with lockout after 5 wrong tries and revocation of a Device.

> Update 2026-09-30 from "Digital key and key card handling": one exception to "no local server at the hotel": the Lock Bridge, a small outbound-only Windows program on the hotel's lock PC. See ADR 0014.

> Update 2026-09-30 from "Support and service levels": availability promise 99.95 % per month with the goal of no noticeable outage: EU database standby with automatic switch-over, application and worker in two zones, updates without downtime.
