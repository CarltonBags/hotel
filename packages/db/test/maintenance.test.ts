import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn, type Actor } from "@hoteloftware/domain";
import { FakeScanner, LocalFileStore } from "@hoteloftware/storage";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms } from "../src/tenant/rooms";
import { deleteExpiredFiles, findFile, storeFile } from "../src/tenant/files";
import { fixIssue, listIssues, reportIssue, takeIssue, visibleFile } from "../src/tenant/maintenance";
import { listRoomStates } from "../src/tenant/room-state";
import { resetTestDatabase, testPool } from "./helpers";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

/**
 * Seams: an upload is checked, scanned and stored under the tenant's prefix;
 * an issue with a Room Block, fixed with the block ended, leaves the room
 * Dirty; another tenant never finds the file; retention deletes it.
 */
describe("Maintenance Issues and file storage", () => {
  let pool: Pool;
  let alpha: Tenant;
  let beta: Tenant;
  let propertyId = "";
  let roomId = "";
  const store = { store: null as unknown as LocalFileStore, scanner: new FakeScanner() };
  const pm = (userId: string): { userId: string; actor: Actor } => ({ userId, actor: { tenantRole: undefined, propertyRoles: [{ propertyId, role: "property_manager" }] } });
  const hk = { userId: "user_hk", actor: { tenantRole: undefined, propertyRoles: [] } as Actor };
  const mt = { userId: "user_mt", actor: { tenantRole: undefined, propertyRoles: [] } as Actor };
  const today = todayIn("Europe/Berlin");

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    alpha = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    beta = await provisionTenant(pool, { slug: "beta", name: "Beta" }, tenantMigrations());
    store.store = new LocalFileStore(await mkdtemp(join(tmpdir(), "hs-files-")));
    const s = alpha.schemaName;
    const le = (await createLegalEntity(pool, s, { name: "A GmbH", country: "DE", addressLine1: "Ring 1", postalCode: "10115", city: "Berlin", vatId: "DE1", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s, { name: "Haus", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    const dbl = (await createRoomType(pool, s, { propertyId, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    await createRooms(pool, s, { propertyId, roomTypeId: dbl, numbers: ["101", "102"] });
    roomId = (await pool.query<{ id: string }>(`select id from ${s}.rooms where number = '101'`)).rows[0]!.id;
    hk.actor.propertyRoles.push({ propertyId, role: "housekeeper" });
    mt.actor.propertyRoles.push({ propertyId, role: "maintenance" });
  });
  afterAll(() => pool.end());

  const upload = (kind: "issue_photo" | "fix_photo", userId: string, bytes = JPEG, contentType = "image/jpeg") =>
    storeFile(pool, alpha.schemaName, store, { tenantId: alpha.id, kind, bytes, contentType, propertyId, userId });

  it("refuses a virus, a wrong type and a renamed file; stores a photo under the tenant's prefix", async () => {
    await expect(upload("issue_photo", hk.userId, new Uint8Array([0xff, 0xd8, 0xff, ...Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")]))).rejects.toThrow(/virus/);
    await expect(upload("issue_photo", hk.userId, new Uint8Array([1, 2]), "text/html")).rejects.toThrow(/Only photos/);
    await expect(upload("issue_photo", hk.userId, new Uint8Array([1, 2, 3, 4]), "image/png")).rejects.toThrow(/not what its type says/);
    const id = await upload("issue_photo", hk.userId);
    const f = (await findFile(pool, alpha.schemaName, id))!;
    expect(f.key).toBe(`${alpha.id}/issue_photo/${id}`);
    expect([...(await store.store.get(f.key))!]).toEqual([...JPEG]);
    // tenant B never finds it, even knowing the id
    expect(await findFile(pool, beta.schemaName, id)).toBeNull();
  });

  it("a reported issue with a Room Block: fixing it and ending the block leaves the room Dirty; the reporter is named", async () => {
    const photo = await upload("issue_photo", hk.userId);
    // a housekeeper reports with photo; a manager blocks the room in the same report
    await expect(reportIssue(pool, alpha.schemaName, { propertyId, roomId, place: "", pick: "plumbing", urgency: "now", note: "Leak", photoFileId: photo, block: { kind: "out_of_order", nights: 3 } }, hk)).rejects.toThrow(/Not allowed to set/);
    const { id, blockId } = await reportIssue(pool, alpha.schemaName, { propertyId, roomId, place: "", pick: "plumbing", urgency: "now", note: "Leak", photoFileId: null, block: { kind: "out_of_order", nights: 3 } }, pm("user_pm"));
    expect(blockId).not.toBeNull();
    // someone else's upload cannot be attached
    await expect(reportIssue(pool, alpha.schemaName, { propertyId, roomId: null, place: "Lobby", pick: "door", urgency: "later", note: "", photoFileId: photo, block: null }, pm("user_pm"))).rejects.toThrow(/Photo not found/);
    const lobby = await reportIssue(pool, alpha.schemaName, { propertyId, roomId: null, place: "Lobby", pick: "door", urgency: "later", note: "", photoFileId: photo, block: null }, hk);
    // the housekeeper may see their own photo, maintenance may see it; another housekeeper not
    expect(await visibleFile(pool, alpha.schemaName, photo, mt)).not.toBeNull();
    expect(await visibleFile(pool, alpha.schemaName, photo, { userId: "user_other", actor: hk.actor })).toBeNull();
    const open = await listIssues(pool, alpha.schemaName, propertyId, "open", mt);
    expect(open.map((i) => [i.roomNumber ?? i.place, i.block?.kind ?? null])).toEqual([["101", "out_of_order"], ["Lobby", null]]);
    await takeIssue(pool, alpha.schemaName, propertyId, id, mt);
    const fixPhoto = await upload("fix_photo", mt.userId);
    // Maintenance holds the right to end an Out of Order block
    const supervisor = { userId: "user_mt", actor: { tenantRole: undefined, propertyRoles: [{ propertyId, role: "maintenance" as const }] } };
    const fixed = await fixIssue(pool, alpha.schemaName, propertyId, id, { note: "Seal replaced", photoFileId: fixPhoto, endBlock: true }, supervisor);
    expect(fixed).toMatchObject({ reportedBy: "user_pm", what: "Room 101 · plumbing" });
    const room = (await listRoomStates(pool, alpha.schemaName, propertyId, pm("user_pm"))).rooms.find((r) => r.number === "101")!;
    expect(room.cleanliness).toBe("dirty");
    const done = await listIssues(pool, alpha.schemaName, propertyId, "done", mt);
    expect(done[0]).toMatchObject({ fixNote: "Seal replaced", fixPhotoFileId: fixPhoto, blockDecision: "ended", block: { inForce: false } });
    // fixing the lobby door keeps no block
    expect((await fixIssue(pool, alpha.schemaName, propertyId, lobby.id, { note: "", photoFileId: null, endBlock: false }, mt)).what).toBe("Lobby · door");
  });

  it("retention deletes files past their day, from storage and record", async () => {
    const files = (await pool.query<{ id: string; key: string; delete_after: string }>(`select id, key, to_char(delete_after, 'YYYY-MM-DD') as delete_after from ${alpha.schemaName}.stored_files where delete_after is not null`)).rows;
    // the upload nobody took up goes after two days, the issue's photos a year after the fix
    expect(files.map((f) => f.delete_after).sort()).toEqual([addDays(today, 2), addDays(today, 365), addDays(today, 365)]);
    expect(await deleteExpiredFiles(pool, alpha.schemaName, store.store, addDays(today, 1))).toBe(0);
    expect(await deleteExpiredFiles(pool, alpha.schemaName, store.store, addDays(today, 3))).toBe(1);
    expect(await deleteExpiredFiles(pool, alpha.schemaName, store.store, addDays(today, 400))).toBe(2);
    for (const f of files) expect(await store.store.get(f.key)).toBeNull();
    const done = await listIssues(pool, alpha.schemaName, propertyId, "done", mt);
    expect(done.every((i) => i.photoFileId === null && i.fixPhotoFileId === null)).toBe(true);
  });
});
