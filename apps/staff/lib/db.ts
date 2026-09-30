import { createPool } from "@hoteloftware/db";
import type { Pool } from "pg";
import { env } from "./env";

/**
 * One pool per server process. On Vercel this is the pooled (transaction-mode)
 * endpoint; tenant queries always go through withTenant, which sets the search
 * path per transaction (ADR 0006).
 */
const globalForDb = globalThis as unknown as { __pool?: Pool };

export function pool(): Pool {
  globalForDb.__pool ??= createPool(env.databaseUrl, 10);
  return globalForDb.__pool;
}
