import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Tenant tables are declared UNQUALIFIED (pgTable, no schema): the same
 * definition serves every tenant through the transaction's search path.
 * Never use pgSchema(...) here. Mirrors migrations/tenant/*.sql.
 */
export const tenantSettings = pgTable("tenant_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantSchema = { tenantSettings };
