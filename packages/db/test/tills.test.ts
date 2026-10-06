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
import { checkIn, loadFolios } from "../src/tenant/folios";
import { createTillConnection, postTillCharge, reconcileTillPosting, tillByKey, tillGuests, tillPostings, TillRefusal } from "../src/tenant/tills";
import { setRoomChargeBlocked } from "../src/tenant/outlets";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: a till posts a bill to a Checked-in guest's folio as one Charge per
 * Tax Code with its items and the tip apart; the same posting twice is taken
 * once; taking a bill back is a Correction of each of its Charges; checked-out
 * guests are refused and the refusal is listed for staff to reconcile (a
 * settled one is not posted again); the
 * lookup returns only guests a till may charge.
 */
describe("Room charge interface for external tills", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let reservation = "";
  let other = "";
  let food = "";
  let key = "";
  const s = () => tenant.schemaName;
  const today = todayIn("Europe/Berlin");
  const pm: { userId: string; actor: Actor; name: string } = { userId: "user_pm", actor: { propertyRoles: [] }, name: "Pia" };
  const till = async () => (await tillByKey(pool, s(), key))!;
  const folio = async (id: string) => (await loadFolios(pool, s(), id)).folios.flatMap((f) => f.charges).filter((c) => c.origin === "outlet");

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
    const code = (c: string) => codes.find((x) => x.code === c)!.id;
    food = code("FOOD");
    const room = await createService(pool, s(), { propertyId, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: code("ACC"), revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const dbl = (await createRoomType(pool, s(), { propertyId, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    const rooms = await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: ["101", "102"] });
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s(), { propertyId, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), propertyId, pm.userId, [0, 1, 2].map((n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price: 100 })));
    const acme = (await createCompany(pool, s(), { name: "Acme AG", onAccount: true }, { userId: pm.userId })).id;
    const stay = async (last: string, roomIndex: number) => {
      const g = (await createGuest(pool, s(), { firstName: "A", lastName: last }, { userId: pm.userId, propertyId })).id;
      const id = (await createBooking(pool, s(), propertyId, pm.userId, { booker: { companyId: acme }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: addDays(today, 2), roomTypeId: dbl, ratePlanId: plan.id, adults: 1, childAges: [], primaryGuestId: g }] })).reservations[0]!.id;
      await assignRoom(pool, s(), id, pm.userId, rooms[roomIndex]!.id);
      await checkIn(pool, s(), id, pm.userId);
      return id;
    };
    reservation = await stay("Tanaka", 0);
    other = await stay("Berg", 1);
    // 7 % is food or accommodation: the till's 7 % is food
    key = (await createTillConnection(pool, s(), propertyId, { kind: "api", name: "Restaurant till", businessReference: "", revenueAccount: "8400", tipAccount: "1590", taxCodes: { "7": food } }, pm)).key;
  });
  afterAll(() => pool.end());

  it("the lookup returns only Checked-in guests a till may charge, with what is left of the limit", async () => {
    await setRoomChargeBlocked(pool, s(), other, true, pm);
    expect((await tillGuests(pool, s(), await till(), "")).map((g) => [g.room, g.name])).toEqual([["101", "Tanaka"]]);
    expect((await tillGuests(pool, s(), await till(), "101"))[0]).toMatchObject({ reservationId: reservation, remaining: expect.any(Number) });
    expect(await tillByKey(pool, s(), "wrong")).toBeNull();
  });

  it("a bill lands as one Charge per Tax Code with its items, the tip apart; the same posting twice is taken once", async () => {
    const bill = {
      externalId: "bill-1",
      corrects: null,
      reservationId: reservation,
      receiptNumber: "4711",
      fiscalId: "TSE-1",
      items: [
        { description: "Schnitzel", quantity: 1, amount: 19.5, taxRate: 7 },
        { description: "Pils", quantity: 2, amount: 9, taxRate: 19 },
      ],
      tip: 3,
    };
    const limitBefore = (await tillGuests(pool, s(), await till(), "101"))[0]!.remaining;
    const first = await postTillCharge(pool, s(), await till(), bill);
    const again = await postTillCharge(pool, s(), await till(), bill);
    expect(again).toEqual({ ...first, duplicate: true });
    const charges = await folio(reservation);
    expect(charges.map((c) => [c.amount, c.taxRate, c.description])).toEqual([
      [19.5, 7, "Restaurant till 4711 · 7 %"],
      [9, 19, "Restaurant till 4711 · 19 %"],
      [3, 0, "Restaurant till 4711 · Tip"],
    ]);
    expect(charges[0]!.detail).toEqual([{ description: "Schnitzel", quantity: 1, amount: 19.5 }]);
    // the tip is outside the Spending Limit
    const left = (await tillGuests(pool, s(), await till(), "101"))[0]!.remaining;
    expect(left).toBe(limitBefore - 28.5);
    // totals without items: per Tax Code, no detail
    await postTillCharge(pool, s(), await till(), { ...bill, externalId: "bill-2", receiptNumber: "4712", items: [], totals: [{ taxRate: 19, amount: 12 }], tip: 0 });
    expect((await folio(reservation)).filter((c) => c.description.includes("4712")).map((c) => [c.amount, c.detail])).toEqual([[12, null]]);
  });

  it("a bill taken back is a Correction of its Charges, once; a negative bill is no way to do it", async () => {
    await postTillCharge(pool, s(), await till(), { externalId: "void-1", corrects: "bill-2", reservationId: "", receiptNumber: "4713", fiscalId: "", items: [], tip: 0 });
    const lines = (await loadFolios(pool, s(), reservation)).folios.flatMap((f) => f.charges).filter((c) => c.description.includes("4712"));
    expect(lines.map((c) => [c.amount, c.origin])).toEqual([
      [12, "outlet"],
      [-12, "correction"],
    ]);
    await expect(postTillCharge(pool, s(), await till(), { externalId: "neg-1", corrects: null, reservationId: reservation, receiptNumber: "4715", fiscalId: "", items: [{ description: "Storno", quantity: -1, amount: -12, taxRate: 19 }], tip: 0 })).rejects.toMatchObject({ code: "invalid" });
    await expect(postTillCharge(pool, s(), await till(), { externalId: "void-2", corrects: "bill-2", reservationId: reservation, receiptNumber: "4714", fiscalId: "", items: [], tip: 0 })).rejects.toThrow(TillRefusal);
  });

  it("a checked-out guest is refused; the refusal is listed until staff reconcile it", async () => {
    await expect(postTillCharge(pool, s(), await till(), { externalId: "bill-9", corrects: null, reservationId: other, receiptNumber: "4720", fiscalId: "", items: [{ description: "Wein", quantity: 1, amount: 30, taxRate: 19 }], tip: 0 })).rejects.toMatchObject({ code: "blocked" });
    await setRoomChargeBlocked(pool, s(), other, false, pm);
    await checkOut(pool, s(), other, pm.userId, { override: true });
    await expect(postTillCharge(pool, s(), await till(), { externalId: "bill-10", corrects: null, reservationId: other, receiptNumber: "4721", fiscalId: "", items: [{ description: "Wein", quantity: 1, amount: 30, taxRate: 19 }], tip: 0 })).rejects.toMatchObject({ code: "not_checked_in" });
    const open = await tillPostings(pool, s(), propertyId, { open: true }, pm);
    expect(open.map((p) => [p.receiptNumber, p.error])).toEqual([
      ["4715", expect.stringMatching(/incomplete/)],
      ["4714", expect.stringMatching(/already taken back/)],
      ["4720", expect.stringMatching(/blocked/)],
      ["4721", expect.stringMatching(/not checked in/)],
    ]);
    await reconcileTillPosting(pool, s(), open[3]!.id, "Posted by hand at the desk", pm);
    expect((await tillPostings(pool, s(), propertyId, { open: true }, pm)).map((p) => p.receiptNumber)).toEqual(["4715", "4714", "4720"]);
    // the till sends the settled bill again: not charged twice
    await expect(postTillCharge(pool, s(), await till(), { externalId: "bill-10", corrects: null, reservationId: reservation, receiptNumber: "4721", fiscalId: "", items: [{ description: "Wein", quantity: 1, amount: 30, taxRate: 19 }], tip: 0 })).rejects.toMatchObject({ code: "settled_at_desk" });
  });
});
