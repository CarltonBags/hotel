import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn } from "@hoteloftware/domain";
import { FakePaymentProvider } from "@hoteloftware/payments";
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
import { assignRoom } from "../src/tenant/reservation-changes";
import { checkIn, postServiceCharge } from "../src/tenant/folios";
import { onboardPaymentAccount, refreshPaymentAccount } from "../src/tenant/payments";
import { portalKeys } from "../src/tenant/portal";
import { cardGuaranteeOf, chargeStoredCard, expressCheckout, expressCheckoutView, finishCardSetup, finishPortalPayment, startCardSetup, startPortalPayment } from "../src/tenant/portal-payments";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: the guest pays the balance with strong customer authentication; a
 * declined card says so once; a stored card secures the stay and is charged
 * later without the guest; express checkout with nothing due checks out where
 * the property allows it, with the final invoice.
 */
describe("Portal payments and express checkout", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let reservationId = "";
  let stayId = "";
  let key = "";
  let stayKey = "";
  let account = "";
  let minibar = "";
  const fd = "user_frida";
  const today = todayIn("Europe/Berlin");
  const s = () => tenant.schemaName;
  const provider = new FakePaymentProvider();

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "A GmbH", country: "DE", addressLine1: "Ring 1", postalCode: "10115", city: "Berlin", vatId: "DE1", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s(), { name: "Haus am Ring", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    await onboardPaymentAccount(pool, s(), provider, { tenantId: tenant.id, legalEntityId: le, email: null, returnUrl: "https://x/back", refreshUrl: "https://x/again" }, "user_owner");
    await refreshPaymentAccount(pool, s(), provider, le);
    account = (await pool.query(`select account_id from ${s()}.payment_accounts`)).rows[0].account_id;
    const dbl = (await createRoomType(pool, s(), { propertyId, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: ["101", "102"] });
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const room = await createService(pool, s(), { propertyId, code: "ROOM", name: "Room", defaultPrice: 0, taxCodeId: codes.find((c) => c.code === "ACC")!.id, revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    minibar = (await createService(pool, s(), { propertyId, code: "MB", name: "Minibar", defaultPrice: 6, taxCodeId: codes.find((c) => c.code === "STD")!.id, revenueAccount: "8400", postingRhythm: "once", bookableOnline: false })).id;
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s(), { propertyId, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), propertyId, fd, Array.from({ length: 6 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price: 100 })));
    const g = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka", email: "aiko@example.com" }, { userId: fd, propertyId })).id;
    // one stay arriving later (deposit), one staying now (express checkout tomorrow)
    const later = await createBooking(pool, s(), propertyId, fd, { booker: { guestId: g }, walkIn: false, notes: "", reservations: [{ arrival: addDays(today, 3), departure: addDays(today, 5), roomTypeId: dbl, ratePlanId: plan.id, adults: 2, childAges: [], primaryGuestId: g }] });
    reservationId = later.reservations[0]!.id;
    key = (await portalKeys(pool, s(), reservationId))!.reservation;
    const now = await createBooking(pool, s(), propertyId, fd, { booker: { guestId: g }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: addDays(today, 1), roomTypeId: dbl, ratePlanId: plan.id, adults: 1, childAges: [], primaryGuestId: g }] });
    stayId = now.reservations[0]!.id;
    stayKey = (await portalKeys(pool, s(), stayId))!.reservation;
    const r101 = (await pool.query<{ id: string }>(`select id from ${s()}.rooms where number = '101'`)).rows[0]!.id;
    await assignRoom(pool, s(), stayId, fd, r101);
    await checkIn(pool, s(), stayId, fd, { notReadyReason: "test" });
  });
  afterAll(() => pool.end());

  it("nothing due, nothing to pay; a payment left unfinished is closed when the next one starts", async () => {
    await expect(startPortalPayment(pool, s(), provider, key, { saveCard: false })).rejects.toThrow(/Nothing is due/);
    const left = await startPortalPayment(pool, s(), provider, stayKey, { saveCard: true });
    await startPortalPayment(pool, s(), provider, stayKey, { saveCard: true });
    expect((await pool.query(`select status from ${s()}.payments where id = $1`, [left.paymentId])).rows[0].status).toBe("failed");
  });

  it("the guest pays the balance with authentication; a decline is told once; a kept card secures the stay", async () => {
    const first = await startPortalPayment(pool, s(), provider, stayKey, { saveCard: true });
    expect(first.clientSecret).toMatch(/_secret$/);
    await provider.simulateOnline(account, (await pool.query(`select provider_intent_id from ${s()}.payments where id = $1`, [first.paymentId])).rows[0].provider_intent_id, "decline");
    const declined = await finishPortalPayment(pool, s(), provider, stayKey, first.paymentId);
    expect(declined).toMatchObject({ status: "failed", error: "Your card was declined", declinedNow: true });
    expect((await finishPortalPayment(pool, s(), provider, stayKey, first.paymentId)).declinedNow).toBe(false);
    const second = await startPortalPayment(pool, s(), provider, stayKey, { saveCard: true });
    await provider.simulateOnline(account, (await pool.query(`select provider_intent_id from ${s()}.payments where id = $1`, [second.paymentId])).rows[0].provider_intent_id, "succeed");
    expect((await finishPortalPayment(pool, s(), provider, stayKey, second.paymentId)).status).toBe("succeeded");
    expect(await cardGuaranteeOf(pool, s(), stayId)).toMatchObject({ brand: "visa", last4: "4242", source: "portal" });
  });

  it("staff charge the stored card later without the guest", async () => {
    await postServiceCharge(pool, s(), stayId, { serviceId: minibar, quantity: 2 }, fd);
    const p = await chargeStoredCard(pool, s(), provider, { reservationId: stayId, amount: 12 }, fd);
    expect(p).toMatchObject({ status: "succeeded", tender: "card_online", amount: 12 });
    const declined = await chargeStoredCard(pool, s(), provider, { reservationId: stayId, amount: 0.13 }, fd);
    expect(declined.status).toBe("failed");
  });

  it("a card stored without paying, through its own authentication", async () => {
    const setup = await startCardSetup(pool, s(), provider, key);
    await provider.simulateSetup(account, setup.setupId, "succeed");
    expect((await finishCardSetup(pool, s(), provider, key, setup.setupId)).status).toBe("succeeded");
    expect(await cardGuaranteeOf(pool, s(), reservationId)).toMatchObject({ last4: "4242" });
  });

  it("express checkout with nothing due: the desk is asked, or the guest checks out alone where allowed, with the final invoice", async () => {
    const view = await expressCheckoutView(pool, s(), stayKey);
    expect(view).toMatchObject({ open: true, balance: 0, checkedOut: false });
    expect(await expressCheckout(pool, s(), provider, stayKey)).toEqual({ checkedOut: false, invoices: [] });
    expect((await expressCheckoutView(pool, s(), stayKey)).requestedAt).toBeTruthy();
    await pool.query(`update ${s()}.properties set express_checkout_auto = true where id = $1`, [propertyId]);
    const done = await expressCheckout(pool, s(), provider, stayKey);
    expect(done.checkedOut).toBe(true);
    expect(done.invoices.length).toBeGreaterThan(0);
    expect((await expressCheckoutView(pool, s(), stayKey)).checkedOut).toBe(true);
  });
});
