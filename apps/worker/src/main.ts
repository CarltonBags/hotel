import { config } from "dotenv";
import { resolve } from "node:path";
import { createPool } from "@hoteloftware/db";
import { queueHealthy, startQueue } from "./queue";
import { startWorkerServer } from "./server";

/**
 * Always-on worker (ADR 0007): job queue, schedules, SSE endpoint fed by
 * LISTEN/NOTIFY, and webhook intake. One process; two instances in ticket 94.
 */
config({ path: resolve(import.meta.dirname, "../../../.env"), quiet: true });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// LISTEN and the queue need a direct connection; the pooler would break both.
const directUrl = process.env.DATABASE_DIRECT_URL ?? (process.env.NODE_ENV === "production" ? required("DATABASE_DIRECT_URL") : required("DATABASE_URL"));
if (!process.env.DATABASE_DIRECT_URL) console.warn("DATABASE_DIRECT_URL not set; using DATABASE_URL (fine locally, never behind a pooler)");
const pool = createPool(directUrl, 6);
const port = Number(process.env.WORKER_PORT ?? 8080);

const boss = await startQueue(pool, directUrl, { tenantCheckCron: process.env.TENANT_CHECK_CRON ?? null });
const queue = Object.assign(boss, { healthy: () => queueHealthy(boss) });
const allowOrigin = process.env.WORKER_ALLOW_ORIGIN ?? (process.env.NODE_ENV === "production" ? undefined : "*");
if (!allowOrigin) console.warn("WORKER_ALLOW_ORIGIN not set; browsers cannot open the event stream");
const server = await startWorkerServer({
  pool,
  listenUrl: directUrl,
  secret: required("BETTER_AUTH_SECRET"),
  port,
  queue,
  allowOrigin,
  testWebhookSecret: process.env.WEBHOOK_TEST_SECRET,
});
console.log(`worker up on :${server.port} (health /health, events /events, webhooks /webhooks/<source>)`);

async function shutdown(signal: string) {
  console.log(`worker stopping (${signal})`);
  const deadline = setTimeout(() => {
    console.error("worker: shutdown took too long, exiting");
    process.exit(1);
  }, 20_000);
  try {
    await server.close();
    await boss.stop({ graceful: true, wait: true, timeout: 15_000 });
    await pool.end();
    clearTimeout(deadline);
    process.exit(0);
  } catch (err) {
    console.error("worker: shutdown failed", err);
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
