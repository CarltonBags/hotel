import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn, type Actor } from "@hoteloftware/domain";
import { checkOut } from "../src/tenant/invoices";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms } from "../src/tenant/rooms";
import { applyTaxPreset, listTaxCodes } from "../src/tenant/tax-codes";
import { createService } from "../src/tenant/services";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createCompany } from "../src/tenant/companies";
import { createBooking } from "../src/tenant/reservations";
import { assignRoom } from "../src/tenant/reservation-changes";
import { checkIn } from "../src/tenant/folios";
import { SimulatedLocks, type LockPlugin } from "@hoteloftware/locks";
import { issueCardKey, readKeyCard, reservationKeys, revokeRoomKey, saveLockSettings, setLockDoor, syncLockKeys } from "../src/tenant/locks";
import { moveRoomInHouse, updateReservation } from "../src/tenant/reservation-changes";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: a key is issued at check-in (door PIN, simulated lock system), runs
 * to check-out time plus the grace, follows an extension and a room move
 * (the old key revoked), and is revoked at check-out, every step logged on
 * the reservation; a desk writes a key card on its encoder and revokes a
 * lost one; an unsupported lock shows "key by lock software" and offers no
 * key actions; a plugin's capabilities decide what is offered.
 */
describe("Door locks and keys", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let reservation = "";
  let rooms: { id: string }[] = [];
  const s = () => tenant.schemaName;
  const today = todayIn("Europe/Berlin");
  const pm: { userId: string; actor: Actor } = { userId: "user_pm", actor: { propertyRoles: [] } };
  const sim = new SimulatedLocks();
  const deps = { sealKey: "test-seal-key-0123456789", pluginFor: (system: string): LockPlugin | null => (system === "simulated" ? sim : null) };
  const keys = async () => (await reservationKeys(pool, s(), reservation, pm, deps))!;
  const live = async () => (await keys()).keys.filter((k) => k.status === "active");

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "A GmbH", country: "DE", addressLine1: "Ring 1", postalCode: "10115", city: "Berlin", vatId: "DE123456789", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s(), { name: "Haus am Ring", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    pm.actor = { propertyRoles: [{ propertyId, role: "property_manager" }] };
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const room = await createService(pool, s(), { propertyId, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: codes.find((x) => x.code === "ACC")!.id, revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const dbl = (await createRoomType(pool, s(), { propertyId, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    rooms = await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: ["101", "102"] });
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s(), { propertyId, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), propertyId, pm.userId, [0, 1, 2, 3].map((n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price: 100 })));
    const acme = (await createCompany(pool, s(), { name: "Acme AG", onAccount: true }, { userId: pm.userId })).id;
    const g = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka", addressLine1: "1-2-3 Shibuya", postalCode: "150-0002", city: "Tokyo", countryOfResidence: "JP" }, { userId: pm.userId, propertyId })).id;
    reservation = (await createBooking(pool, s(), propertyId, pm.userId, { booker: { companyId: acme }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: addDays(today, 2), roomTypeId: dbl, ratePlanId: plan.id, adults: 1, childAges: [], primaryGuestId: g }] })).reservations[0]!.id;
    await assignRoom(pool, s(), reservation, pm.userId, rooms[0]!.id);
    await saveLockSettings(pool, s(), propertyId, { system: "simulated", otherName: "", handover: "door_pin", graceMinutes: 60, secret: null }, pm, deps);
    await setLockDoor(pool, s(), rooms[0]!.id, "door-101", pm);
    await setLockDoor(pool, s(), rooms[1]!.id, "door-102", pm);
  });
  afterAll(() => pool.end());

  it("a door PIN is issued at check-in and runs to check-out time plus the grace", async () => {
    expect((await syncLockKeys(pool, s(), deps)).done).toBe(0);
    await checkIn(pool, s(), reservation, pm.userId);
    expect(await syncLockKeys(pool, s(), deps)).toEqual({ done: 1, failed: 0 });
    const [k] = await live();
    expect(k).toMatchObject({ room: "101", kind: "pin", pin: expect.stringMatching(/^[1-9]{6}$/), validUntil: new Date(`${addDays(today, 2)}T12:00:00+02:00`).toISOString() });
    expect([...sim.keys.values()].filter((x) => !x.revoked).map((x) => [x.lockRef, x.pin])).toEqual([["door-101", k!.pin]]);
  });

  it("an extension moves the key's end; a room move gives a key for the new door and revokes the old", async () => {
    await updateReservation(pool, s(), reservation, pm.userId, { departure: addDays(today, 3) });
    await syncLockKeys(pool, s(), deps);
    expect((await live()).map((k) => [k.room, k.validUntil])).toEqual([["101", new Date(`${addDays(today, 3)}T12:00:00+02:00`).toISOString()]]);
    // a move from tomorrow: the key changes doors when the Business Date reaches that night
    await moveRoomInHouse(pool, s(), reservation, pm.userId, rooms[1]!.id, addDays(today, 1), { force: true });
    await syncLockKeys(pool, s(), deps);
    expect((await live()).map((k) => k.room)).toEqual(["101"]);
    await pool.query(`update ${s()}.properties set business_date = $2 where id = $1`, [propertyId, addDays(today, 1)]);
    await syncLockKeys(pool, s(), deps);
    expect((await live()).map((k) => k.room)).toEqual(["102"]);
    expect((await keys()).events.map((e) => e.action)).toEqual(expect.arrayContaining(["issued", "updated", "revoked"]));
  });

  it("the desk writes a key card on its encoder, reads it back and revokes it when lost", async () => {
    const id = await issueCardKey(pool, s(), reservation, "enc-desk-1", pm, deps);
    expect(await readKeyCard(pool, s(), propertyId, "enc-desk-1", pm, deps)).toMatchObject({ room: "102", reservationId: reservation });
    await revokeRoomKey(pool, s(), id, pm, deps);
    expect((await keys()).keys.find((k) => k.id === id)).toMatchObject({ status: "revoked", revokeReason: "lost" });
  });

  it("check-out revokes every key", async () => {
    await checkOut(pool, s(), reservation, pm.userId, { override: true });
    await syncLockKeys(pool, s(), deps);
    expect(await live()).toEqual([]);
    expect([...sim.keys.values()].every((x) => x.revoked)).toBe(true);
  });

  it("an unsupported lock shows key by lock software and offers nothing; capabilities decide the actions", async () => {
    expect((await keys()).actions).toEqual({ issueCard: true, revoke: true, readCard: true, showPin: true });
    await saveLockSettings(pool, s(), propertyId, { system: "nuki", otherName: "", handover: "door_pin", graceMinutes: 60, secret: "nuki-token" }, pm, deps);
    expect((await keys()).actions).toEqual({ issueCard: false, revoke: true, readCard: false, showPin: true });
    await saveLockSettings(pool, s(), propertyId, { system: "other", otherName: "Messerschmitt", handover: "reception", graceMinutes: 60, secret: null }, pm, deps);
    expect(await keys()).toMatchObject({ system: "other", otherName: "Messerschmitt", actions: { issueCard: false, revoke: false, readCard: false, showPin: false } });
  });
});
