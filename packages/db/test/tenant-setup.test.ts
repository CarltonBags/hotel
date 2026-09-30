import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity, listLegalEntities } from "../src/tenant/legal-entities";
import { createProperty, listProperties } from "../src/tenant/properties";
import { loadActor, listTenantUsers, setPropertyRoles, setTenantRole } from "../src/control/roles";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: Legal Entities and Properties in the tenant schema (ADR 0002: a
 * Property belongs to exactly one Legal Entity); role assignments in the
 * control schema; loadActor builds the Actor the permission check needs.
 */
describe("tenant setup", () => {
  let pool: Pool;
  let tenant: Tenant;
  let other: Tenant;

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha Hotels" }, tenantMigrations());
    other = await provisionTenant(pool, { slug: "beta", name: "Beta Resorts" }, tenantMigrations());
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("creates a Legal Entity with invoice header, VAT ID and bank details", async () => {
    const le = await createLegalEntity(pool, tenant.schemaName, {
      name: "Alpha Hotels GmbH",
      addressLine1: "Hauptstraße 1",
      postalCode: "10115",
      city: "Berlin",
      country: "DE",
      vatId: "DE123456789",
      iban: "DE89370400440532013000",
      bic: "COBADEFFXXX",
      accountHolder: "Alpha Hotels GmbH",
    });
    expect(le.id).toMatch(/^[0-9a-f-]{36}$/);
    const list = await listLegalEntities(pool, tenant.schemaName);
    expect(list.map((l) => l.name)).toEqual(["Alpha Hotels GmbH"]);
    // the other tenant sees nothing
    expect(await listLegalEntities(pool, other.schemaName)).toEqual([]);
  });

  it("creates a Property that belongs to exactly one Legal Entity", async () => {
    const [le] = await listLegalEntities(pool, tenant.schemaName);
    const property = await createProperty(pool, tenant.schemaName, {
      name: "Alpha Berlin Mitte",
      legalEntityId: le!.id,
      country: "DE",
      timeZone: "Europe/Berlin",
      currency: "EUR",
    });
    expect(property.legalEntityId).toBe(le!.id);
    const list = await listProperties(pool, tenant.schemaName);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Alpha Berlin Mitte", legalEntityName: "Alpha Hotels GmbH", timeZone: "Europe/Berlin" });
  });

  it("refuses a Property without a valid Legal Entity, time zone, country or currency", async () => {
    const [le] = await listLegalEntities(pool, tenant.schemaName);
    const base = { name: "X", legalEntityId: le!.id, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" };
    await expect(
      createProperty(pool, tenant.schemaName, { ...base, legalEntityId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toThrow(/legal entity/i);
    await expect(createProperty(pool, tenant.schemaName, { ...base, timeZone: "Mars/Olympus" })).rejects.toThrow(/time zone/i);
    await expect(createProperty(pool, tenant.schemaName, { ...base, country: "XX" })).rejects.toThrow(/country/i);
    await expect(createProperty(pool, tenant.schemaName, { ...base, currency: "XXX" })).rejects.toThrow(/currency/i);
  });

  it("assigns tenant and property roles and loads them as an Actor", async () => {
    const [property] = await listProperties(pool, tenant.schemaName);
    await pool.query(
      `insert into control."user" (id, tenant_id, name, email) values ('u1', $1, 'Bob', 'bob@example.com'), ('u2', $1, 'Eve', 'eve@example.com')`,
      [tenant.id],
    );
    await setTenantRole(pool, { tenantId: tenant.id, userId: "u1", role: "tenant_admin" });
    await setPropertyRoles(pool, { tenantId: tenant.id, userId: "u2", propertyId: property!.id, roles: ["front_desk", "revenue"] });

    expect(await loadActor(pool, tenant.id, "u1")).toEqual({ tenantRole: "tenant_admin", propertyRoles: [] });
    expect(await loadActor(pool, tenant.id, "u2")).toEqual({
      tenantRole: undefined,
      propertyRoles: [
        { propertyId: property!.id, role: "front_desk" },
        { propertyId: property!.id, role: "revenue" },
      ],
    });

    // replacing the role set at a property removes what is no longer listed
    await setPropertyRoles(pool, { tenantId: tenant.id, userId: "u2", propertyId: property!.id, roles: ["front_desk"] });
    expect((await loadActor(pool, tenant.id, "u2")).propertyRoles).toEqual([{ propertyId: property!.id, role: "front_desk" }]);

    // a tenant role can be removed
    await setTenantRole(pool, { tenantId: tenant.id, userId: "u1", role: null });
    expect((await loadActor(pool, tenant.id, "u1")).tenantRole).toBeUndefined();
  });

  it("never returns roles of another tenant's user", async () => {
    expect(await loadActor(pool, other.id, "u2")).toEqual({ tenantRole: undefined, propertyRoles: [] });
  });

  it("lists the tenant's users with their roles", async () => {
    const users = await listTenantUsers(pool, tenant.id);
    expect(users.map((u) => u.email).sort()).toEqual(["bob@example.com", "eve@example.com"]);
    const eve = users.find((u) => u.email === "eve@example.com")!;
    expect(eve.propertyRoles).toHaveLength(1);
    expect(eve.propertyRoles[0]!.role).toBe("front_desk");
  });

  it("refuses unknown role names at the database", async () => {
    await expect(
      pool.query(`insert into control.property_roles (tenant_id, user_id, property_id, role) values ($1, 'u2', gen_random_uuid(), 'king')`, [
        tenant.id,
      ]),
    ).rejects.toThrow(/check|invalid input value/i);
  });
});
