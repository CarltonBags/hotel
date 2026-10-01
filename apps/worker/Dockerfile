# Always-on worker (ADR 0007). Build from the repository root:
#   docker build -f apps/worker/Dockerfile -t hoteloftware-worker .
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.17.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/events/package.json packages/events/
RUN pnpm install --frozen-lockfile --filter @hoteloftware/worker...

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/worker apps/worker
COPY packages/db packages/db
COPY packages/domain packages/domain
COPY packages/events packages/events

# tsx runs TypeScript directly; the workspace packages are source packages.
FROM build AS runtime
ENV NODE_ENV=production
ENV WORKER_PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
WORKDIR /repo/apps/worker
CMD ["pnpm", "exec", "tsx", "src/main.ts"]
