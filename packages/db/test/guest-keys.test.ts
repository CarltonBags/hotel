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
import { guestKeys, issueKioskCard, saveLockSettings, setDeskEncoder, setLockDoor, syncLockKeys } from "../src/tenant/locks";
import { portalKeys } from "../src/tenant/portal";
import { resetTestDatabase, testPool } from "./helpers";

describe("Keys for guests", () => {
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
  let portal = "";
  const settings = (handover: string) => saveLockSettings(pool, s(), propertyId, { system: "simulated", otherName: "", handover, graceMinutes: 60, secret: null }, pm, deps);

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
    await settings("digital_key");
    portal = (await portalKeys(pool, s(), reservation))!.reservation;
    await setLockDoor(pool, s(), rooms[0]!.id, "door-101", pm);
    await setLockDoor(pool, s(), rooms[1]!.id, "door-102", pm);
  });
  afterAll(() => pool.end());

  it("a Digital Key appears for the guest's phone once Checked-in, a door PIN where the handover is a PIN", async () => {
    expect(await guestKeys(pool, s(), portal, deps)).toEqual({ handover: "digital_key", keys: [] });
    await checkIn(pool, s(), reservation, pm.userId);
    await syncLockKeys(pool, s(), deps);
    expect((await guestKeys(pool, s(), portal, deps))!.keys).toEqual([{ kind: "phone", room: "101", validUntil: expect.any(String), pin: null, guestKey: expect.stringMatching(/^https:\/\/keys\.example\/sim\//) }]);
    await settings("door_pin");
    await syncLockKeys(pool, s(), deps);
    // one way of handing over: the Digital Key goes, the door PIN comes
    expect((await guestKeys(pool, s(), portal, deps))!.keys.map((k) => [k.kind, /^[1-9]{6}$/.test(k.pin ?? "")])).toEqual([["pin", true]]);
  });

  it("the kiosk writes the card on its own encoder, once for a double tap", async () => {
    const kiosk = { deviceId: "8b0a2c3e-1d4f-4a6b-9c8d-7e6f5a4b3c2d", propertyId };
    await expect(issueKioskCard(pool, s(), portal, kiosk, deps)).rejects.toThrow(/reception/);
    await settings("kiosk_encoder");
    // a kiosk of the property
    const [t] = (await pool.query<{ id: string }>("select id from control.tenants where schema_name = $1", [s()])).rows;
    await pool.query("insert into control.devices (id, tenant_id, property_id, kind, guest_mode, name, token_hash, enrolled_by) values ($1, $2, $3, 'guest', 'kiosk', 'Kiosk', 'x', 'test')", [kiosk.deviceId, t!.id, propertyId]);
    // a Portal Link alone makes no card: only right after Self Check-in on this kiosk
    await expect(issueKioskCard(pool, s(), portal, kiosk, deps)).rejects.toThrow(/reception/);
    await pool.query(`insert into ${s()}.self_checkins (reservation_id, property_id, channel, device_id, step, outcome, finished_at) values ($1, $2, 'kiosk', $3, 'result', 'checked_in', clock_timestamp())`, [reservation, propertyId, kiosk.deviceId]);
    await expect(issueKioskCard(pool, s(), portal, kiosk, deps)).rejects.toThrow(/no encoder/);
    await setDeskEncoder(pool, s(), propertyId, kiosk.deviceId, "enc-kiosk", pm);
    // two taps at once: one card
    expect(await Promise.all([issueKioskCard(pool, s(), portal, kiosk, deps), issueKioskCard(pool, s(), portal, kiosk, deps)])).toEqual([{ room: "101" }, { room: "101" }]);
    expect([...sim.keys.values()].filter((k) => k.kind === "card" && k.encoderId === "enc-kiosk" && k.lockRef === "door-101")).toHaveLength(1);
  });

  it("at check-out the guest's keys vanish", async () => {
    await checkOut(pool, s(), reservation, pm.userId, { override: true });
    await syncLockKeys(pool, s(), deps);
    expect((await guestKeys(pool, s(), portal, deps))!.keys).toEqual([]);
  });
});
