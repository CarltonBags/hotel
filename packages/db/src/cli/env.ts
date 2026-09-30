import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(import.meta.dirname, "../../../../.env"), quiet: true });

/**
 * Migrations and provisioning use the DIRECT connection (DATABASE_DIRECT_URL),
 * never the transaction-mode pooler; DATABASE_URL is the fallback for local work.
 */
export function directDatabaseUrl(): string {
  const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_DIRECT_URL or DATABASE_URL is not set (copy .env.example to .env)");
  return url;
}
