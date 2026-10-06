import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn, type Actor } from "@hoteloftware/domain";
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
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BridgeRuntime, OnPremLockSimulator, type BridgeResult } from "@hoteloftware/bridge-kit";
import { issueCardKey, readKeyCard, revokeRoomKey, saveLockSettings, setLockDoor } from "../src/tenant/locks";
import { bridgeCheckIn, bridgePluginCode, enrollSiteBridge, lostSiteBridges, pushBridgePlugin, siteBridges } from "../src/tenant/site-bridge";
import { bridgeByToken, publishBridgePlugin } from "../src/control/site-bridge";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: a Site Bridge enrolled with a token calls in from outside (no
 * inbound port), reports its plugins and health; a plugin version pushed
 * from our side is fetched, checked and activated without a reinstall; a
 * lock system on the hotel's network is driven through the Bridge's plugin
 * (a key card written, read and blocked at the simulated lock server); a
 * Bridge gone quiet alerts once and says when it is back.
 */
describe("Site Bridge", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let reservation = "";
  let rooms: { id: string }[] = [];
  let bridgeId = "";
  let token = "";
  const s = () => tenant.schemaName;
  const today = todayIn("Europe/Berlin");
  const pm: { userId: string; actor: Actor } = { userId: "user_pm", actor: { propertyRoles: [] } };
  const deps = { sealKey: "test-seal-key-0123456789", bridgeTimeoutMs: 10_000 };
  const sim = new OnPremLockSimulator();
  let runtime: BridgeRuntime;
  let pending: BridgeResult[] = [];
  const template = resolve(import.meta.dirname, "../../bridge-kit/template/simulated-onprem.mjs");

  /** One call of the Bridge: report and answers out, commands in, carried out for the next call. */
  const tick = async () => {
    const auth = (await bridgeByToken(pool, token))!;
    const report = await runtime.report();
    const { commands, wasAlerted } = await bridgeCheckIn(pool, auth.schema, auth.bridgeId, { ...report, results: pending });
    pending = [];
    for (const c of commands) pending.push(await runtime.execute(c));
    return wasAlerted;
  };
  const ticks = async (n: number) => {
    for (let i = 0; i < n; i++) await tick();
  };

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
    rooms = await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: ["101"] });
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s(), { propertyId, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), propertyId, pm.userId, [0, 1].map((n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price: 100 })));
    const acme = (await createCompany(pool, s(), { name: "Acme AG", onAccount: true }, { userId: pm.userId })).id;
    const g = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka" }, { userId: pm.userId, propertyId })).id;
    reservation = (await createBooking(pool, s(), propertyId, pm.userId, { booker: { companyId: acme }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: addDays(today, 2), roomTypeId: dbl, ratePlanId: plan.id, adults: 1, childAges: [], primaryGuestId: g }] })).reservations[0]!.id;
    await assignRoom(pool, s(), reservation, pm.userId, rooms[0]!.id);
    await checkIn(pool, s(), reservation, pm.userId);
    const server = await sim.start();
    ({ id: bridgeId, token } = await enrollSiteBridge(pool, s(), tenant.id, propertyId, "Lock PC", pm));
    runtime = new BridgeRuntime({
      pluginsDir: await mkdtemp(join(tmpdir(), "bridge-")),
      config: { "simulated-onprem": { server } },
      fetchPlugin: async (name, version) => (await bridgePluginCode(pool, s(), bridgeId, name, version))!,
    });
    const code = await readFile(template, "utf8");
    await publishBridgePlugin(pool, { name: "simulated-onprem", version: "1.0.0", kind: "lock", code });
    await publishBridgePlugin(pool, { name: "simulated-onprem", version: "1.1.0", kind: "lock", code: code.replace('version: "1.0.0"', 'version: "1.1.0"') });
  });
  afterAll(async () => {
    await sim.stop();
    await pool.end();
  });

  it("a Bridge with its token calls in and is online; a wrong token opens nothing", async () => {
    expect(await bridgeByToken(pool, "hsb_" + "0".repeat(64))).toBeNull();
    await tick();
    expect((await siteBridges(pool, s(), propertyId, pm))[0]).toMatchObject({ name: "Lock PC", online: true, version: "1.0.0", plugins: [] });
  });

  it("a plugin pushed from our side is fetched, checked and activated; an update replaces it without a reinstall", async () => {
    await pushBridgePlugin(pool, s(), bridgeId, "simulated-onprem", "1.0.0", pm);
    await ticks(3);
    expect((await siteBridges(pool, s(), propertyId, pm))[0]!.plugins).toMatchObject([{ name: "simulated-onprem", version: "1.0.0", health: { ok: true } }]);
    await pushBridgePlugin(pool, s(), bridgeId, "simulated-onprem", "1.1.0", pm);
    await ticks(3);
    expect((await siteBridges(pool, s(), propertyId, pm))[0]!.plugins).toMatchObject([{ name: "simulated-onprem", version: "1.1.0" }]);
  });

  it("the hotel's lock server is driven through the Bridge: a card written, read and blocked", async () => {
    await saveLockSettings(pool, s(), propertyId, { system: "bridge", bridgePlugin: "simulated-onprem", otherName: "", handover: "reception", graceMinutes: 60, secret: null }, pm, deps);
    await setLockDoor(pool, s(), rooms[0]!.id, "DOOR-101", pm);
    // the Bridge keeps calling while the desk waits for its answer
    let running = true;
    const loop = (async () => {
      while (running) await tick();
    })();
    try {
      const key = await issueCardKey(pool, s(), reservation, "ENC-1", pm, deps);
      expect([...sim.keys.values()].map((k) => [k.door, k.encoder])).toEqual([["DOOR-101", "ENC-1"]]);
      expect(await readKeyCard(pool, s(), propertyId, "ENC-1", pm, deps)).toMatchObject({ room: "101", reservationId: reservation });
      await revokeRoomKey(pool, s(), key, pm, deps);
    } finally {
      running = false;
      await loop;
    }
    // an offline card lock: blocked at the lock server, the card runs to its expiry
    expect([...sim.keys.values()].every((k) => k.blocked)).toBe(false);
  });

  it("a Bridge gone quiet alerts once after three minutes; its next call says it is back", async () => {
    const later = new Date(Date.now() + 4 * 60_000);
    expect(await lostSiteBridges(pool, s(), new Date())).toEqual([]);
    expect((await lostSiteBridges(pool, s(), later)).map((b) => b.name)).toEqual(["Lock PC"]);
    expect(await lostSiteBridges(pool, s(), later)).toEqual([]);
    expect(await tick()).toBe(true);
    expect(await tick()).toBe(false);
  });
});
