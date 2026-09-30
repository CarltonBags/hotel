import { config } from "dotenv";
import { resolve } from "node:path";
import { createPool } from "@hoteloftware/db";

/**
 * Always-on worker (ADR 0007). Ticket 10 only proves it starts and reaches the
 * database; the job queue, schedules, SSE and webhook intake come in ticket 13.
 */
config({ path: resolve(import.meta.dirname, "../../../.env"), quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const pool = createPool(url, 2);
const { rows } = await pool.query<{ n: number }>("select count(*)::int as n from control.tenants");
console.log(`worker up; ${rows[0]?.n ?? 0} tenant(s) in control schema`);
await pool.end();
