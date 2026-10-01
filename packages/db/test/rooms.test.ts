import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import {
  createRoomType,
  createRooms,
  createSection,
  createRoomFeature,
  listRooms,
  listRoomTypes,
  roomCapacityHistory,
  saveAgeBands,
  listAgeBands,
  updateRoom,
  updateRoomType,
  listRoomFeatures,
  listSections,
  deleteRoom,
  deleteSection,
} from "../src/tenant/rooms";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: Room Types, Rooms, Room Features, Sections and Age Bands per property.
 * Bed places and extra beds per room keep a dated history for statistics.
 */
describe("rooms setup", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId: string;

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = await createLegalEntity(pool, tenant.schemaName, { name: "Alpha GmbH", country: "DE" });
    propertyId = (await createProperty(pool, tenant.schemaName, { name: "Alpha Berlin", legalEntityId: le.id, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("creates 20 room types and 400 rooms and lists them quickly", async () => {
    const start = Date.now();
    const types: string[] = [];
    for (let i = 0; i < 20; i++) {
      const rt = await createRoomType(pool, tenant.schemaName, {
        propertyId,
        code: `T${String(i + 1).padStart(2, "0")}`,
        name: `Type ${i + 1}`,
        names: { en: `Type ${i + 1}`, de: `Typ ${i + 1}` },
        maxOccupancy: 2 + (i % 3),
        maxAdults: 2,
        bedPlaces: 2,
        extraBeds: i % 2,
      });
      types.push(rt.id);
    }
    for (let t = 0; t < 20; t++) {
      await createRooms(pool, tenant.schemaName, {
        propertyId,
        roomTypeId: types[t]!,
        numbers: Array.from({ length: 20 }, (_, i) => `${t + 1}${String(i + 1).padStart(2, "0")}`),
        floor: String(t + 1),
      });
    }
    const listStart = Date.now();
    const rooms = await listRooms(pool, tenant.schemaName, propertyId);
    const listed = Date.now() - listStart;
    expect(rooms).toHaveLength(400);
    expect((await listRoomTypes(pool, tenant.schemaName, propertyId)).map((t) => t.roomCount)).toEqual(Array(20).fill(20));
    expect(listed).toBeLessThan(500);
    expect(Date.now() - start).toBeLessThan(20_000);
  });

  it("refuses a duplicate room number and a duplicate room type code at the property", async () => {
    const [type] = await listRoomTypes(pool, tenant.schemaName, propertyId);
    await expect(createRooms(pool, tenant.schemaName, { propertyId, roomTypeId: type!.id, numbers: ["101"], floor: "1" })).rejects.toThrow(/already exists/i);
    await expect(createRoomType(pool, tenant.schemaName, { propertyId, code: "T01", name: "Dup", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).rejects.toThrow(/already exists/i);
  });

  it("room features and sections are assigned to a room and shown on it", async () => {
    const view = await createRoomFeature(pool, tenant.schemaName, { propertyId, code: "sea_view", name: "Sea view" });
    const balcony = await createRoomFeature(pool, tenant.schemaName, { propertyId, code: "balcony", name: "Balcony" });
    const west = await createSection(pool, tenant.schemaName, { propertyId, name: "West wing" });
    const [room] = await listRooms(pool, tenant.schemaName, propertyId);
    await updateRoom(pool, tenant.schemaName, propertyId, room!.id, { featureIds: [view.id, balcony.id], sectionId: west.id, floor: "1" });
    const updated = (await listRooms(pool, tenant.schemaName, propertyId)).find((r) => r.id === room!.id)!;
    expect(updated.features.map((f) => f.code).sort()).toEqual(["balcony", "sea_view"]);
    expect(updated.sectionName).toBe("West wing");
    expect((await listRoomFeatures(pool, tenant.schemaName, propertyId)).map((f) => f.code)).toEqual(["balcony", "sea_view"]);
    expect((await listSections(pool, tenant.schemaName, propertyId)).map((s) => s.name)).toEqual(["West wing"]);
  });

  it("bed place changes keep a dated history per room; the current counts follow the row in effect today", async () => {
    const [room] = await listRooms(pool, tenant.schemaName, propertyId);
    await updateRoom(pool, tenant.schemaName, propertyId, room!.id, { bedPlaces: 3, extraBeds: 1 });
    await updateRoom(pool, tenant.schemaName, propertyId, room!.id, { bedPlaces: 4, extraBeds: 1, validFrom: "2099-01-01" });
    const history = await roomCapacityHistory(pool, tenant.schemaName, room!.id);
    expect(history.map((h) => [h.validFrom, h.bedPlaces, h.extraBeds])).toEqual([
      [expect.any(String), 3, 1],
      ["2099-01-01", 4, 1],
    ]);
    const current = (await listRooms(pool, tenant.schemaName, propertyId)).find((r) => r.id === room!.id)!;
    expect([current.bedPlaces, current.extraBeds]).toEqual([3, 1]);
  });

  it("room names and translations merge; an emptied translation is removed", async () => {
    const [room] = await listRooms(pool, tenant.schemaName, propertyId);
    await updateRoom(pool, tenant.schemaName, propertyId, room!.id, { name: "Suite Bellevue", names: { en: "Bellevue Suite", de: "Suite Bellevue" } });
    await updateRoom(pool, tenant.schemaName, propertyId, room!.id, { names: { de: "" } });
    const r = (await listRooms(pool, tenant.schemaName, propertyId)).find((x) => x.id === room!.id)!;
    expect([r.name, r.names]).toEqual(["Suite Bellevue", { en: "Bellevue Suite" }]);
  });

  it("room type translations merge into the stored ones", async () => {
    const [type] = await listRoomTypes(pool, tenant.schemaName, propertyId);
    await updateRoomType(pool, tenant.schemaName, propertyId, type!.id, { names: { en: "Standard Double" } });
    const updated = (await listRoomTypes(pool, tenant.schemaName, propertyId)).find((t) => t.id === type!.id)!;
    expect(updated.names).toEqual({ en: "Standard Double", de: "Typ 1" });
    expect(updated.name).toBe("Type 1");
  });

  it("writes are scoped to the property: another property's ids are not found", async () => {
    const otherLe = await createLegalEntity(pool, tenant.schemaName, { name: "Other", country: "DE" });
    const other = (await createProperty(pool, tenant.schemaName, { name: "Other", legalEntityId: otherLe.id, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    const [room] = await listRooms(pool, tenant.schemaName, propertyId);
    const [type] = await listRoomTypes(pool, tenant.schemaName, propertyId);
    const [section] = await listSections(pool, tenant.schemaName, propertyId);
    await expect(updateRoom(pool, tenant.schemaName, other, room!.id, { floor: "9" })).rejects.toThrow(/not found/);
    await expect(deleteRoom(pool, tenant.schemaName, other, room!.id)).rejects.toThrow(/not found/);
    await expect(updateRoomType(pool, tenant.schemaName, other, type!.id, { name: "X" })).rejects.toThrow(/not found/);
    await expect(deleteSection(pool, tenant.schemaName, other, section!.id)).rejects.toThrow(/not found/);
    const otherType = await createRoomType(pool, tenant.schemaName, { propertyId: other, code: "O1", name: "O", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 });
    await expect(createRooms(pool, tenant.schemaName, { propertyId: other, roomTypeId: otherType.id, numbers: ["1"], sectionId: section!.id })).rejects.toThrow(/Section not found/);
  });

  it("age bands are saved as a whole and validated", async () => {
    await saveAgeBands(pool, tenant.schemaName, propertyId, [
      { name: "Infant", minAge: 0, maxAge: 2 },
      { name: "Child", minAge: 3, maxAge: 11 },
      { name: "Adult", minAge: 12, maxAge: null },
    ]);
    expect((await listAgeBands(pool, tenant.schemaName, propertyId)).map((b) => b.name)).toEqual(["Infant", "Child", "Adult"]);
    await expect(
      saveAgeBands(pool, tenant.schemaName, propertyId, [
        { name: "Child", minAge: 0, maxAge: 11 },
        { name: "Adult", minAge: 13, maxAge: null },
      ]),
    ).rejects.toThrow(/gap/i);
    expect((await listAgeBands(pool, tenant.schemaName, propertyId)).map((b) => b.name)).toEqual(["Infant", "Child", "Adult"]);
  });
});
