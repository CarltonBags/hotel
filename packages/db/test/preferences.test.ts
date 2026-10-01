import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { getPreferences, getWorkspace, setPinnedTabs, setPreferences } from "../src/control/preferences";
import { setTenantAccent } from "../src/tenant/provision";
import { findTenantBySlug } from "../src/tenant/provision";
import { resetTestDatabase, testPool } from "./helpers";

/** Seam: shell settings per user, pinned tabs per user and property scope, accent per tenant. */
describe("preferences and workspace", () => {
  let pool: Pool;
  let tenant: Tenant;

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    await pool.query(`insert into control."user" (id, tenant_id, name, email) values ('u1', $1, 'Bob', 'bob@example.com')`, [tenant.id]);
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("defaults: English, system theme, no Quick Access override", async () => {
    expect(await getPreferences(pool, "u1")).toEqual({ language: "en", theme: "system", quickAccess: null });
  });

  it("stores language, theme and Quick Access per user", async () => {
    await setPreferences(pool, "u1", { language: "de", theme: "dark" });
    await setPreferences(pool, "u1", { quickAccess: ["today", "calendar"] });
    expect(await getPreferences(pool, "u1")).toEqual({ language: "de", theme: "dark", quickAccess: ["today", "calendar"] });
    await expect(setPreferences(pool, "u1", { language: "fr" as "de" })).rejects.toThrow();
  });

  it("keeps pinned tabs, record tabs included, per user and property scope", async () => {
    const today = { id: "today", kind: "module" as const, module: "today", title: "Today", href: "/" };
    const guest = { id: "guests:42", kind: "record" as const, module: "guests", title: "Aiko Tanaka", href: "/guests/42" };
    expect(await getWorkspace(pool, "u1", "all")).toEqual({ pinnedTabs: [] });
    await setPinnedTabs(pool, "u1", "all", [today]);
    await setPinnedTabs(pool, "u1", "prop-1", [today, guest]);
    expect(await getWorkspace(pool, "u1", "all")).toEqual({ pinnedTabs: [today] });
    expect(await getWorkspace(pool, "u1", "prop-1")).toEqual({ pinnedTabs: [today, guest] });
    await setPinnedTabs(pool, "u1", "prop-1", []);
    expect(await getWorkspace(pool, "u1", "prop-1")).toEqual({ pinnedTabs: [] });
    await expect(setPinnedTabs(pool, "u1", "all", [{ ...guest, href: "javascript:alert(1)" }])).rejects.toThrow(/invalid/i);
  });

  it("stores the tenant accent, Ocean by default", async () => {
    expect((await findTenantBySlug(pool, "alpha"))?.accent).toBe("ocean");
    await setTenantAccent(pool, tenant.id, "plum");
    expect((await findTenantBySlug(pool, "alpha"))?.accent).toBe("plum");
    await expect(setTenantAccent(pool, tenant.id, "neon")).rejects.toThrow(/accent/i);
  });
});
