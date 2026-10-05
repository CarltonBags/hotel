import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn, type Actor } from "@hoteloftware/domain";
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
import { createCompany } from "../src/tenant/companies";
import { createBooking } from "../src/tenant/reservations";
import { assignRoom } from "../src/tenant/reservation-changes";
import { checkIn, loadFolios } from "../src/tenant/folios";
import { ApprovalRequired } from "../src/tenant/approvals";
import { onboardPaymentAccount, refreshPaymentAccount, registerTerminalReader, simulateCard, syncPayment } from "../src/tenant/payments";
import { createCashRegister, setCashDesk } from "../src/tenant/cash";
import {
  addBillItem,
  chargeBillToRoom,
  createOutlet,
  openOutletBill,
  outletBill,
  outletReport,
  roomChargeGuests,
  saveMenuItem,
  sendOrderRound,
  setBillDiscount,
  startOutletCardPayment,
  voidBillLine,
} from "../src/tenant/outlets";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: a Room Charge only for a guest in house, within the Spending Limit
 * or with an Approval, as one Charge per Tax Code with the items as detail;
 * tap to pay on a phone takes Visa and refuses girocard (the reader takes
 * it, with a tip added there); discounts beyond the outlet's percentage and
 * voids of sent items need an Outlet Manager; outlet reports per outlet, day
 * and user.
 */
describe("Outlet payments", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let bar = "";
  let pils = "";
  let schnitzel = "";
  let reservation = "";
  let phone = "";
  let reader = "";
  const s = () => tenant.schemaName;
  const today = todayIn("Europe/Berlin");
  const provider = new FakePaymentProvider();
  const pm: { userId: string; actor: Actor } = { userId: "user_pm", actor: { propertyRoles: [] } };
  const om: { userId: string; actor: Actor } = { userId: "user_om", actor: { propertyRoles: [] } };
  const mia: { userId: string; actor: Actor; name: string } = { userId: "user_mia", actor: { propertyRoles: [] }, name: "Mia" };

  const bill = async (items: [string, number][]) => {
    const b = await openOutletBill(pool, s(), bar, { tableId: null, label: "" }, mia);
    for (const [item, quantity] of items) await addBillItem(pool, s(), b, { menuItemId: item, quantity, modifiers: [], note: "" }, mia);
    await sendOrderRound(pool, s(), b, mia);
    return b;
  };

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "A GmbH", country: "DE", addressLine1: "Ring 1", postalCode: "10115", city: "Berlin", vatId: "DE123456789", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s(), { name: "Haus am Ring", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    pm.actor = { propertyRoles: [{ propertyId, role: "property_manager" }] };
    om.actor = { propertyRoles: [{ propertyId, role: "outlet_manager" }] };
    mia.actor = { propertyRoles: [{ propertyId, role: "service" }] };
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const code = (c: string) => codes.find((x) => x.code === c)!.id;
    const room = await createService(pool, s(), { propertyId, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: code("ACC"), revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const drinks = await createService(pool, s(), { propertyId, code: "DRINK", name: "Getränke", defaultPrice: 0, taxCodeId: code("STD"), revenueAccount: "8410", postingRhythm: "once", bookableOnline: false });
    const food = await createService(pool, s(), { propertyId, code: "FOODS", name: "Speisen", defaultPrice: 0, taxCodeId: code("FOOD"), revenueAccount: "8400", postingRhythm: "once", bookableOnline: false });
    await setCashDesk(pool, s(), propertyId, { enabled: true, tolerance: 5, paidOutLimit: 100, differenceAccount: "1370" });
    const register = await createCashRegister(pool, s(), propertyId, "Bar till");
    bar = await createOutlet(pool, s(), propertyId, { name: "Bar", kind: "bar", cashRegisterId: register, active: true }, pm);
    await pool.query(`update ${s()}.outlets set discount_percent = 10 where id = $1`, [bar]);
    pils = await saveMenuItem(pool, s(), bar, { serviceId: drinks.id, name: "Pils", category: "Drinks", price: 4.5, printerId: null, modifiers: [], active: true, sortOrder: 1 }, pm);
    schnitzel = await saveMenuItem(pool, s(), bar, { serviceId: food.id, name: "Schnitzel", category: "Food", price: 19, printerId: null, modifiers: [], active: true, sortOrder: 2 }, pm);
    // a guest in house whose company pays on account: Room Charge is covered
    const dbl = (await createRoomType(pool, s(), { propertyId, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    const rooms = await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: ["101", "102"] });
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s(), { propertyId, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), propertyId, pm.userId, [0, 1, 2].map((n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price: 100 })));
    const acme = (await createCompany(pool, s(), { name: "Acme AG", onAccount: true }, { userId: pm.userId })).id;
    const guest = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka" }, { userId: pm.userId, propertyId })).id;
    const b = await createBooking(pool, s(), propertyId, pm.userId, { booker: { companyId: acme }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: addDays(today, 2), roomTypeId: dbl, ratePlanId: plan.id, adults: 1, childAges: [], primaryGuestId: guest }] });
    reservation = b.reservations[0]!.id;
    await assignRoom(pool, s(), reservation, pm.userId, rooms[0]!.id);
    await checkIn(pool, s(), reservation, pm.userId);
    // the property's payment account, a paired reader and a staff phone for tap to pay
    await onboardPaymentAccount(pool, s(), provider, { tenantId: tenant.id, legalEntityId: le, email: null, returnUrl: "https://x/back", refreshUrl: "https://x/again" }, "user_owner");
    await refreshPaymentAccount(pool, s(), provider, le);
    reader = (await registerTerminalReader(pool, s(), provider, propertyId, { registrationCode: "bar-1", label: "Bar reader" }, pm.userId)).readerId;
    phone = (await registerTerminalReader(pool, s(), provider, propertyId, { registrationCode: "mia-phone", label: "Mia's phone", kind: "phone" }, pm.userId)).readerId;
  });
  afterAll(() => pool.end());

  it("a bill with 7 % and 19 % items becomes two Charges on the stay's folio, the items as detail", async () => {
    const b = await bill([
      [schnitzel, 2],
      [pils, 3],
    ]);
    const [guest] = await roomChargeGuests(pool, s(), bar, "101", mia);
    // the staff member sees room, surname, yes or no and the limit left, never card data
    expect(guest).toEqual({ reservationId: reservation, room: "101", lastName: "Tanaka", allowed: true, remaining: 150 });
    expect(await chargeBillToRoom(pool, s(), b, { reservationId: reservation, signature: null }, mia)).toEqual({ charges: 2, total: 51.5 });
    const charges = (await loadFolios(pool, s(), reservation)).folios.flatMap((f) => f.charges).filter((c) => c.origin === "outlet");
    expect(charges.map((c) => [c.taxRate, c.amount, c.detail])).toEqual([
      [7, 38, [{ description: "Schnitzel", quantity: 2, amount: 38 }]],
      [19, 13.5, [{ description: "Pils", quantity: 3, amount: 13.5 }]],
    ]);
    expect((await outletBill(pool, s(), b, mia)).roomCharge).toEqual({ room: "101", guest: "Tanaka" });
  });

  it("a Room Charge is refused for a checked-out guest, and above the Spending Limit without an Approval", async () => {
    // 51.50 charged tonight: 98.50 left of 150
    const big = await bill([[schnitzel, 6]]);
    await expect(chargeBillToRoom(pool, s(), big, { reservationId: reservation, signature: null }, mia)).rejects.toBeInstanceOf(ApprovalRequired);
    // the Outlet Manager approves on the device
    await chargeBillToRoom(pool, s(), big, { reservationId: reservation, signature: null }, { ...mia, approverId: om.userId });
    await pool.query(`update ${s()}.reservations set room_charge_blocked = true where id = $1`, [reservation]);
    const small = await bill([[pils, 1]]);
    await expect(chargeBillToRoom(pool, s(), small, { reservationId: reservation, signature: null }, mia)).rejects.toThrow(/blocked/);
    await pool.query(`update ${s()}.reservations set room_charge_blocked = false, status = 'checked_out' where id = $1`, [reservation]);
    await expect(chargeBillToRoom(pool, s(), small, { reservationId: reservation, signature: null }, mia)).rejects.toThrow(/not checked in/);
    expect(await roomChargeGuests(pool, s(), bar, "Tanaka", mia)).toEqual([]);
    await pool.query(`update ${s()}.reservations set status = 'checked_in' where id = $1`, [reservation]);
  });

  it("tap to pay on a phone completes for Visa; a girocard is refused there and taken by the reader, with a tip added on it", async () => {
    const a = await bill([[pils, 2]]);
    const p = await startOutletCardPayment(pool, s(), provider, a, { readerId: phone, tip: 1 }, mia);
    expect((await outletBill(pool, s(), a, mia)).status).toBe("paying");
    // nothing can be added while the card is at the device
    await expect(addBillItem(pool, s(), a, { menuItemId: pils, quantity: 1, modifiers: [], note: "" }, mia)).rejects.toThrow(/closed/);
    await simulateCard(pool, s(), provider, { paymentId: p.id }, { brand: "visa" });
    expect(await outletBill(pool, s(), a, mia)).toMatchObject({ status: "paid", due: 9, tip: 1 });

    const g = await bill([[pils, 2]]);
    const onPhone = await startOutletCardPayment(pool, s(), provider, g, { readerId: phone, tip: 0 }, mia);
    await simulateCard(pool, s(), provider, { paymentId: onPhone.id }, { brand: "girocard" });
    expect((await syncPayment(pool, s(), provider, onPhone.id)).status).toBe("failed");
    expect((await outletBill(pool, s(), g, mia)).status).toBe("open");
    await expect(startOutletCardPayment(pool, s(), provider, g, { readerId: reader, tip: 1 }, mia)).rejects.toThrow(/On the reader the guest adds the tip/);
    const onReader = await startOutletCardPayment(pool, s(), provider, g, { readerId: reader, tip: 0 }, mia);
    await simulateCard(pool, s(), provider, { paymentId: onReader.id }, { brand: "girocard", tip: 2 });
    expect(await outletBill(pool, s(), g, mia)).toMatchObject({ status: "paid", due: 9, tip: 2 });
    // the receipt's money is the bill's; the tip apart
    const charges = (await pool.query(`select sum(c.amount)::numeric as t from ${s()}.charges c join ${s()}.folios f on f.id = c.folio_id where f.outlet_bill_id = $1`, [g])).rows[0].t;
    expect(Number(charges)).toBe(9);
  });

  it("a discount above the outlet's percentage needs an Approval; a sent item is voided by the Outlet Manager, not by Service", async () => {
    const b = await bill([
      [schnitzel, 1],
      [pils, 2],
    ]);
    await setBillDiscount(pool, s(), b, 10, mia);
    await expect(setBillDiscount(pool, s(), b, 20, mia)).rejects.toBeInstanceOf(ApprovalRequired);
    await setBillDiscount(pool, s(), b, 20, om);
    const pilsLine = (await outletBill(pool, s(), b, mia)).lines.find((l) => l.description === "Pils")!;
    await expect(voidBillLine(pool, s(), b, pilsLine.id, "spilled", mia)).rejects.toBeInstanceOf(ApprovalRequired);
    await voidBillLine(pool, s(), b, pilsLine.id, "spilled", om);
    const view = await outletBill(pool, s(), b, mia);
    expect(view).toMatchObject({ total: 19, discountPercent: 20, discount: 3.8, due: 15.2 });
    expect(view.lines.find((l) => l.id === pilsLine.id)!.voided).toEqual({ reason: "spilled" });
    // tonight's limit is used up: the Outlet Manager charges it
    await chargeBillToRoom(pool, s(), b, { reservationId: reservation, signature: null }, om);
  });

  it("the outlet report shows per outlet, day and user what was paid, charged, discounted, tipped and voided", async () => {
    const rows = await outletReport(pool, s(), propertyId, { from: today, to: today }, pm);
    // by who closed the bill: Mia four, the Outlet Manager the one beyond tonight's limit
    expect(rows.map((r) => [r.outlet, r.userId, r.bills, r.paid, r.roomCharged, r.discounts, r.tips, r.voids])).toEqual([
      ["Bar", "user_mia", 4, 18, 51.5 + 114, 0, 3, 0],
      ["Bar", "user_om", 1, 0, 15.2, 3.8, 0, 1],
    ]);
    // Service sees no report
    expect(await outletReport(pool, s(), propertyId, { from: today, to: today }, mia)).toEqual([]);
  });
});
