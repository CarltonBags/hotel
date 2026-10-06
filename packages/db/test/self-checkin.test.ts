import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn } from "@hoteloftware/domain";
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
import { createBooking } from "../src/tenant/reservations";
import { portalKeys } from "../src/tenant/portal";
import { assignRoom } from "../src/tenant/reservation-changes";
import { findForKiosk, finishSelfCheckin, selfCheckinLine, selfCheckinRegister, startSelfCheckin } from "../src/tenant/self-checkin";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: a kiosk finds only today's arrivals, by number and last name; the
 * guest's part of the Austrian registration is signed on screen; all
 * Check-in Conditions met, the stay is Checked-in with its Charges posted and
 * a ready room; the room not ready, the guest is Arrived, Waiting for Room;
 * anything else, reception helps and the desk's live line says why.
 */
describe("Self Check-in", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let book: (lastName: string, o?: { adults?: number; arrival?: string; plan?: "card" | "full" }) => Promise<{ id: string; key: string; confirmation: string }>;
  const fd = "user_frida";
  const today = todayIn("Europe/Vienna");
  const s = () => tenant.schemaName;
  const kiosk = { kind: "kiosk" as const, deviceId: "00000000-0000-4000-8000-000000000001", propertyId: "" };
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const details = { firstName: "Aiko", lastName: "Tanaka", dateOfBirth: "1988-04-05", nationality: "JP", addressLine1: "1-2-3 Shibuya", postalCode: "150-0002", city: "Tokyo", country: "JP", documentNumber: "TK1234567", gender: "f" };
  const rooms = (cleanliness: string) => pool.query(`update ${s()}.rooms set cleanliness = $1`, [cleanliness]);

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "Donau GmbH", country: "AT", addressLine1: "Ring 1", postalCode: "1010", city: "Wien", vatId: "ATU12345678", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s(), { name: "Hotel Donau", legalEntityId: le, country: "AT", timeZone: "Europe/Vienna", currency: "EUR" })).id;
    kiosk.propertyId = propertyId;
    const dbl = (await createRoomType(pool, s(), { propertyId, code: "DBL", name: "Double", maxOccupancy: 3, maxAdults: 2, bedPlaces: 2, extraBeds: 1 })).id;
    await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: ["501", "502", "503", "504", "505", "506", "507", "508"] });
    await applyTaxPreset(pool, s(), le, "AT");
    const codes = await listTaxCodes(pool, s(), le);
    const room = await createService(pool, s(), { propertyId, code: "ROOM", name: "Room", defaultPrice: 0, taxCodeId: codes[0]!.id, revenueAccount: "4000", postingRhythm: "per_night", bookableOnline: false });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plans = {
      card: (await createRatePlan(pool, s(), { propertyId, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: (await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" })).id, cancellationPolicyId: cxl.id })).id,
      full: (await createRatePlan(pool, s(), { propertyId, code: "PRE", name: "Prepaid", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: (await createPaymentPolicy(pool, s(), { propertyId, name: "Full", kind: "full" })).id, cancellationPolicyId: cxl.id })).id,
    };
    for (const plan of Object.values(plans)) await setRates(pool, s(), propertyId, fd, Array.from({ length: 5 }, (_, n) => ({ ratePlanId: plan, roomTypeId: dbl, date: addDays(today, n), price: 120 })));
    // check-in from midnight: the tests do not depend on the hour
    await pool.query(`insert into ${s()}.property_messaging (property_id, checkin_time) values ($1, '00:00')`, [propertyId]);
    book = async (lastName, o = {}) => {
      const g = (await createGuest(pool, s(), { firstName: "Aiko", lastName, nationality: "JP" }, { userId: fd, propertyId })).id;
      const arrival = o.arrival ?? today;
      const b = await createBooking(pool, s(), propertyId, fd, { booker: { guestId: g }, walkIn: false, notes: "", reservations: [{ arrival, departure: addDays(arrival, 2), roomTypeId: dbl, ratePlanId: plans[o.plan ?? "card"], adults: o.adults ?? 1, childAges: [], primaryGuestId: g }] });
      const id = b.reservations[0]!.id;
      return { id, key: (await portalKeys(pool, s(), id))!.reservation, confirmation: b.confirmationNumber };
    };
  });
  afterAll(() => pool.end());

  it("a kiosk finds today's arrival by confirmation number and last name, nothing else", async () => {
    const stay = await book("Tanaka");
    const later = await book("Tanaka", { arrival: addDays(today, 1) });
    expect(await findForKiosk(pool, s(), propertyId, { confirmationNumber: stay.confirmation, lastName: "Müller" })).toBeNull();
    expect(await findForKiosk(pool, s(), propertyId, { confirmationNumber: stay.confirmation.toLowerCase(), lastName: " tanaka" })).toBe(stay.key);
    expect(await findForKiosk(pool, s(), propertyId, { confirmationNumber: later.confirmation, lastName: "Tanaka" })).toBeNull();
    expect(await findForKiosk(pool, s(), propertyId, { key: stay.key })).toBe(stay.key);
  });

  it("all conditions met: registered and signed on screen, the stay is Checked-in with a ready room and its Charges posted", async () => {
    await rooms("inspected");
    const stay = await book("Sato");
    const start = await startSelfCheckin(pool, s(), stay.key, kiosk);
    expect(start.failed).toEqual(["registration"]);
    expect(start.registration.form?.person.step).toBe("details");
    await selfCheckinRegister(pool, s(), stay.key, { step: "details", details: { ...details, lastName: "Sato" } }, kiosk);
    await selfCheckinRegister(pool, s(), stay.key, { step: "companions", add: [] }, kiosk);
    await expect(selfCheckinRegister(pool, s(), stay.key, { step: "review", signaturePng: null }, kiosk)).rejects.toThrow(/signature/);
    const signed = await selfCheckinRegister(pool, s(), stay.key, { step: "review", signaturePng: png }, kiosk);
    expect(signed.failed).toEqual([]);
    const done = await finishSelfCheckin(pool, s(), stay.key, kiosk);
    // the guest signed; the ID Check is the desk's, still open
    expect(done).toMatchObject({ outcome: "checked_in", roomNumber: "501", idCheckOpen: true });
    const r = (await pool.query(`select status, checked_in_by from ${s()}.reservations where id = $1`, [stay.id])).rows[0];
    expect(r).toEqual({ status: "checked_in", checked_in_by: "self-checkin" });
    expect((await pool.query(`select count(*)::int as n from ${s()}.charges where reservation_id = $1 and origin = 'stay' and voided_at is null`, [stay.id])).rows[0].n).toBeGreaterThan(0);
  });

  it("the room not ready: the guest finishes as Arrived, Waiting for Room", async () => {
    await rooms("dirty");
    const stay = await book("Suzuki");
    await startSelfCheckin(pool, s(), stay.key, kiosk);
    await selfCheckinRegister(pool, s(), stay.key, { step: "details", details: { ...details, lastName: "Suzuki" } }, kiosk);
    await selfCheckinRegister(pool, s(), stay.key, { step: "companions", add: [] }, kiosk);
    const v = await selfCheckinRegister(pool, s(), stay.key, { step: "review", signaturePng: png }, kiosk);
    expect(v.failed).toEqual(["room_not_ready"]);
    expect(await finishSelfCheckin(pool, s(), stay.key, kiosk)).toMatchObject({ outcome: "waiting", roomNumber: null });
    const r = (await pool.query(`select status, waiting_for_room_since is not null as waiting from ${s()}.reservations where id = $1`, [stay.id])).rows[0];
    expect(r).toEqual({ status: "confirmed", waiting: true });
    // a room is planned for the guest and its preparation is the priority on the board
    const task = (await pool.query(`select t.priority from ${s()}.housekeeping_tasks t where t.reservation_id = $1 and t.kind = 'arrival'`, [stay.id])).rows[0];
    expect(task).toEqual({ priority: true });
  });

  it("an assigned room not ready gives way to a free ready room of the type", async () => {
    await rooms("dirty");
    const stay = await book("Mori");
    await assignRoom(pool, s(), stay.id, fd, (await pool.query(`select id from ${s()}.rooms where number = '503'`)).rows[0].id);
    await pool.query(`update ${s()}.rooms set cleanliness = 'inspected' where number = '504'`);
    await startSelfCheckin(pool, s(), stay.key, kiosk);
    await selfCheckinRegister(pool, s(), stay.key, { step: "details", details: { ...details, lastName: "Mori" } }, kiosk);
    await selfCheckinRegister(pool, s(), stay.key, { step: "companions", add: [] }, kiosk);
    await selfCheckinRegister(pool, s(), stay.key, { step: "review", signaturePng: png }, kiosk);
    expect(await finishSelfCheckin(pool, s(), stay.key, kiosk)).toMatchObject({ outcome: "checked_in", roomNumber: "504" });
  });

  it("everyone staying is declared; a second adult's own form sends the guest to reception", async () => {
    await rooms("inspected");
    const stay = await book("Ito", { adults: 2 });
    await startSelfCheckin(pool, s(), stay.key, { kind: "phone" });
    await selfCheckinRegister(pool, s(), stay.key, { step: "details", details: { ...details, lastName: "Ito" } }, { kind: "phone" as const });
    await expect(selfCheckinRegister(pool, s(), stay.key, { step: "companions", add: [] }, { kind: "phone" as const })).rejects.toThrow(/companions/);
    const v = await selfCheckinRegister(pool, s(), stay.key, { step: "companions", add: [{ role: "partner", firstName: "Ken", lastName: "Ito", dateOfBirth: "1987-01-01", nationality: "JP" }] }, { kind: "phone" as const });
    expect(v.registration.status).toBe("reception");
    // on the phone only once the guest is at the hotel
    await expect(finishSelfCheckin(pool, s(), stay.key, { kind: "phone" })).rejects.toThrow(/at the hotel/);
    expect(await finishSelfCheckin(pool, s(), stay.key, { kind: "phone", here: true })).toMatchObject({ outcome: "help", failed: ["registration"] });
  });

  it("a balance still due: reception helps, and the desk's live line says why", async () => {
    const stay = await book("Kato", { plan: "full" });
    await startSelfCheckin(pool, s(), stay.key, kiosk);
    await selfCheckinRegister(pool, s(), stay.key, { step: "details", details: { ...details, lastName: "Kato" } }, kiosk);
    await selfCheckinRegister(pool, s(), stay.key, { step: "companions", add: [] }, kiosk);
    const v = await selfCheckinRegister(pool, s(), stay.key, { step: "review", signaturePng: png }, kiosk);
    expect(v.failed).toEqual(["payment"]);
    expect(v.amountDue).toBe(240);
    expect(await finishSelfCheckin(pool, s(), stay.key, kiosk)).toMatchObject({ outcome: "help", failed: ["payment"] });
    const line = await selfCheckinLine(pool, s(), [propertyId]);
    expect(line.find((l) => l.reservationId === stay.id)).toMatchObject({ guestName: "Aiko Kato", outcome: "help", reason: ["payment"], channel: "kiosk" });
    expect(line.find((l) => l.guestName === "Aiko Sato")).toMatchObject({ outcome: "checked_in", roomNumber: "501" });
  });
});
