import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { addTaxRate, applyTaxPreset, createTaxCode, listTaxCodes, removeTaxRate, taxRateFor } from "../src/tenant/tax-codes";
import { createService, listServices, updateService } from "../src/tenant/services";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: Tax Codes per Legal Entity with dated rates; Services per property
 * that reference a Tax Code of the property's Legal Entity.
 */
describe("tax codes and services", () => {
  let pool: Pool;
  let tenant: Tenant;
  let legalEntityId: string;
  let otherLegalEntityId: string;
  let propertyId: string;

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    legalEntityId = (await createLegalEntity(pool, tenant.schemaName, { name: "Alpha GmbH", country: "DE" })).id;
    otherLegalEntityId = (await createLegalEntity(pool, tenant.schemaName, { name: "Beta AG", country: "AT" })).id;
    propertyId = (await createProperty(pool, tenant.schemaName, { name: "Alpha Berlin", legalEntityId, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("applies the German preset to a Legal Entity once", async () => {
    const created = await applyTaxPreset(pool, tenant.schemaName, legalEntityId, "DE");
    expect(created.map((t) => t.code)).toEqual(["ACC", "FOOD", "STD", "ZERO"]);
    const codes = await listTaxCodes(pool, tenant.schemaName, legalEntityId);
    expect(codes.find((c) => c.code === "ACC")?.rates).toEqual([{ validFrom: "2000-01-01", rate: 7 }]);
    expect(codes.find((c) => c.code === "FOOD")?.rates.map((r) => r.rate)).toEqual([19, 7]);
    expect(await applyTaxPreset(pool, tenant.schemaName, legalEntityId, "DE")).toEqual([]);
  });

  it("a rate change from a date leaves earlier dates untouched", async () => {
    const acc = (await listTaxCodes(pool, tenant.schemaName, legalEntityId)).find((c) => c.code === "ACC")!;
    await addTaxRate(pool, tenant.schemaName, legalEntityId, acc.id, { validFrom: "2027-01-01", rate: 9 });
    expect(await taxRateFor(pool, tenant.schemaName, acc.id, "2026-12-31")).toBe(7);
    expect(await taxRateFor(pool, tenant.schemaName, acc.id, "2027-01-01")).toBe(9);
    const after = (await listTaxCodes(pool, tenant.schemaName, legalEntityId)).find((c) => c.code === "ACC")!;
    expect(after.rates.map((r) => r.rate)).toEqual([7, 9]);
    expect(after.currentRate).toBe(7);
  });

  it("rates in force today or earlier are immutable; only future rates can change or go", async () => {
    const acc = (await listTaxCodes(pool, tenant.schemaName, legalEntityId)).find((c) => c.code === "ACC")!;
    await expect(addTaxRate(pool, tenant.schemaName, legalEntityId, acc.id, { validFrom: "2000-01-01", rate: 5 })).rejects.toThrow(/cannot be changed/);
    await expect(addTaxRate(pool, tenant.schemaName, legalEntityId, acc.id, { validFrom: "2025-06-01", rate: 5 })).rejects.toThrow(/cannot be changed/);
    await expect(removeTaxRate(pool, tenant.schemaName, legalEntityId, acc.id, "2000-01-01")).rejects.toThrow(/cannot be removed/);
    await addTaxRate(pool, tenant.schemaName, legalEntityId, acc.id, { validFrom: "2027-01-01", rate: 10 });
    await removeTaxRate(pool, tenant.schemaName, legalEntityId, acc.id, "2027-01-01");
    expect((await listTaxCodes(pool, tenant.schemaName, legalEntityId)).find((c) => c.code === "ACC")!.rates).toEqual([{ validFrom: "2000-01-01", rate: 7 }]);
  });

  it("creates a custom Tax Code and refuses a duplicate code at the Legal Entity", async () => {
    const t = await createTaxCode(pool, tenant.schemaName, legalEntityId, { code: "PARK", name: "Parking", rate: 19, validFrom: "2020-01-01" });
    expect(t.code).toBe("PARK");
    await expect(createTaxCode(pool, tenant.schemaName, legalEntityId, { code: "park", name: "Dup", rate: 19, validFrom: "2020-01-01" })).rejects.toThrow(/already exists/i);
  });

  it("creates services with all fields and lists them", async () => {
    const codes = await listTaxCodes(pool, tenant.schemaName, legalEntityId);
    const acc = codes.find((c) => c.code === "ACC")!;
    const food = codes.find((c) => c.code === "FOOD")!;
    await createService(pool, tenant.schemaName, {
      propertyId,
      code: "ROOM",
      name: "Übernachtung",
      names: { en: "Overnight stay" },
      defaultPrice: 129.0,
      taxCodeId: acc.id,
      revenueAccount: "8300",
      postingRhythm: "per_night",
      bookableOnline: false,
    });
    await createService(pool, tenant.schemaName, {
      propertyId,
      code: "BRK",
      name: "Frühstück",
      names: { en: "Breakfast" },
      defaultPrice: 18.5,
      taxCodeId: food.id,
      revenueAccount: "8400",
      postingRhythm: "per_person_night",
      bookableOnline: true,
    });
    const list = await listServices(pool, tenant.schemaName, propertyId);
    // catalogue order is the hotel's own (sort order), not alphabetical
    expect(list.map((s) => [s.code, s.defaultPrice, s.taxCodeCode, s.postingRhythm, s.currentTaxRate])).toEqual([
      ["ROOM", 129, "ACC", "per_night", 7],
      ["BRK", 18.5, "FOOD", "per_person_night", 7],
    ]);
  });

  it("refuses a Tax Code of another Legal Entity and a negative price", async () => {
    await applyTaxPreset(pool, tenant.schemaName, otherLegalEntityId, "AT");
    const foreign = (await listTaxCodes(pool, tenant.schemaName, otherLegalEntityId))[0]!;
    const base = { propertyId, code: "X", name: "X", defaultPrice: 1, taxCodeId: foreign.id, revenueAccount: "1", postingRhythm: "once" as const, bookableOnline: false };
    await expect(createService(pool, tenant.schemaName, base)).rejects.toThrow(/Tax Code/);
    const own = (await listTaxCodes(pool, tenant.schemaName, legalEntityId))[0]!;
    await expect(createService(pool, tenant.schemaName, { ...base, taxCodeId: own.id, defaultPrice: -1 })).rejects.toThrow(/price/i);
  });

  it("updates a service's price, tax code and account separately", async () => {
    const brk = (await listServices(pool, tenant.schemaName, propertyId)).find((s) => s.code === "BRK");
    const std = (await listTaxCodes(pool, tenant.schemaName, legalEntityId)).find((c) => c.code === "STD")!;
    await updateService(pool, tenant.schemaName, propertyId, brk!.id, { defaultPrice: 19.9 });
    await updateService(pool, tenant.schemaName, propertyId, brk!.id, { taxCodeId: std.id, revenueAccount: "8401" });
    const after = (await listServices(pool, tenant.schemaName, propertyId)).find((s) => s.id === brk!.id)!;
    expect([after.defaultPrice, after.taxCodeCode, after.revenueAccount, after.currentTaxRate]).toEqual([19.9, "STD", "8401", 19]);
  });
});
