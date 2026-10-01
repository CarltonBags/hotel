# Hoteloftware

Multi-tenant hotel property management system. Spec: `CONTEXT.md`, `docs/adr/`, `docs/research/`, `.scratch/hotel-pms-v1/map.md`. Build tickets: `.scratch/hotel-pms-v1-build/`.

## Layout

- `apps/staff` – staff app (Next.js), served at `<tenant>.<APP_DOMAIN>`
- `apps/guest` – Guest Portal, Self Check-in kiosk and registration tablet
- `apps/worker` – always-on worker (jobs, live updates, webhooks)
- `packages/db` – Postgres access: control schema, one schema per tenant, migration runner
- `packages/auth` – Better Auth, tenant-scoped sign-in
- `packages/ui` – design tokens
- `apps/staff-shell-prototype` – throwaway prototypes from planning (not in the workspace)

## Local setup

Requires Node 20, pnpm 10 and a local Postgres 16.

```sh
createdb hoteloftware_dev && createdb hoteloftware_test
cp .env.example .env
ln -s ../../.env apps/staff/.env && ln -s ../../.env apps/guest/.env   # Next.js reads .env from the app directory
pnpm install
pnpm db:migrate                 # control schema + every tenant schema
pnpm db:provision alpha "Alpha Hotels GmbH"
pnpm --filter @hoteloftware/auth create-user alpha you@example.com yourname "Your Name" "a long password" owner
pnpm --filter @hoteloftware/staff dev
```

Open `http://alpha.localhost:3000` (Chrome resolves `*.localhost` to 127.0.0.1) and sign in.

## Checks

```sh
pnpm -r typecheck
pnpm -r test                    # needs TEST_DATABASE_URL
pnpm db:check-tenant-sql        # tenant SQL must never name a schema
```

## Tenancy rules (ADR 0006)

- Tenant tables are declared unqualified; the same SQL runs in every tenant schema through the search path.
- Every tenant query runs inside `withTenant(...)`, which sets the search path for that transaction only.
- Migrations run once per tenant, record the version per tenant in the same transaction, and stop on the first failure.
