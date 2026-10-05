import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn, type Actor } from "@hoteloftware/domain";
import { FakeFiscalProvider } from "@hoteloftware/fiscal";
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
import { checkIn } from "../src/tenant/folios";
import { createCashRegister, openShift, receiptByToken, setCashDesk } from "../src/tenant/cash";
import { registerFiscalClients, setUpFiscal, signReceipt } from "../src/tenant/fiscal";
import { ORDER_SIGN_SECONDS, signOutletOrders } from "../src/tenant/fiscal-orders";
import { onboardPaymentAccount, refreshPaymentAccount, refundPayment, registerTerminalReader, simulateCard, syncPayment } from "../src/tenant/payments";
import { addBillItem, createOutlet, openOutletBill, outletBill, saveMenuItem, sendOrderRound, startOutletCardPayment, voidBillLine } from "../src/tenant/outlets";
import { applyOutletOps, outletSnapshot, type OutletOp } from "../src/tenant/outlet-sync";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: in Germany every order round is signed by the TSE as an order
 * within 45 seconds and a void as a new negative order, bill and orders
 * sharing the table key; what a device sold offline (two orders and a cash
 * payment) is applied once each, in order, then signed; an offline Room
 * Charge that no longer holds is left for staff; a card a reader took offline
 * is at the hotel's risk and not refunded until forwarded.
 */
describe("Outlet signing and offline selling", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let bar = "";
  let pils = "";
  let reader = "";
  let guest = "";
  const s = () => tenant.schemaName;
  const today = todayIn("Europe/Berlin");
  const fiscal = new FakeFiscalProvider();
  const deps = { provider: fiscal, secret: "a-test-fiscal-secret" };
  const payments = new FakePaymentProvider();
  const pm: { userId: string; actor: Actor; name: string } = { userId: "user_pm", actor: { propertyRoles: [] }, name: "Pia" };
  const mia: { userId: string; actor: Actor; name: string } = { userId: "user_mia", actor: { propertyRoles: [] }, name: "Mia" };

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "A GmbH", country: "DE", addressLine1: "Ring 1", postalCode: "10115", city: "Berlin", vatId: "DE123456789", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s(), { name: "Haus am Ring", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    pm.actor = { propertyRoles: [{ propertyId, role: "property_manager" }] };
    mia.actor = { propertyRoles: [{ propertyId, role: "service" }] };
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const code = (c: string) => codes.find((x) => x.code === c)!.id;
    const drinks = await createService(pool, s(), { propertyId, code: "DRINK", name: "Getränke", defaultPrice: 0, taxCodeId: code("STD"), revenueAccount: "8410", postingRhythm: "once", bookableOnline: false });
    await setCashDesk(pool, s(), propertyId, { enabled: true, tolerance: 5, paidOutLimit: 100, differenceAccount: "1370" });
    const register = await createCashRegister(pool, s(), propertyId, "Bar till");
    bar = await createOutlet(pool, s(), propertyId, { name: "Bar", kind: "bar", cashRegisterId: register, active: true }, pm);
    pils = await saveMenuItem(pool, s(), bar, { serviceId: drinks.id, name: "Pils", category: "", price: 4.5, printerId: null, modifiers: [], active: true, sortOrder: 1 }, pm);
    // the TSE, its clients registered (the bar's register among them)
    await setUpFiscal(pool, s(), deps, propertyId, pm.userId);
    await registerFiscalClients(pool, s(), deps, propertyId);
    await openShift(pool, s(), { registerId: register, count: {} }, mia);
    // a guest in house, covered by an on-account Company
    const room = await createService(pool, s(), { propertyId, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: code("ACC"), revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const dbl = (await createRoomType(pool, s(), { propertyId, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    const rooms = await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: ["101"] });
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s(), { propertyId, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), propertyId, pm.userId, [0, 1].map((n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price: 100 })));
    const acme = (await createCompany(pool, s(), { name: "Acme AG", onAccount: true }, { userId: pm.userId })).id;
    const g = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka" }, { userId: pm.userId, propertyId })).id;
    guest = (await createBooking(pool, s(), propertyId, pm.userId, { booker: { companyId: acme }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: addDays(today, 1), roomTypeId: dbl, ratePlanId: plan.id, adults: 1, childAges: [], primaryGuestId: g }] })).reservations[0]!.id;
    await assignRoom(pool, s(), guest, pm.userId, rooms[0]!.id);
    await checkIn(pool, s(), guest, pm.userId);
    await onboardPaymentAccount(pool, s(), payments, { tenantId: tenant.id, legalEntityId: le, email: null, returnUrl: "https://x/back", refreshUrl: "https://x/again" }, "user_owner");
    await refreshPaymentAccount(pool, s(), payments, le);
    reader = (await registerTerminalReader(pool, s(), payments, propertyId, { registrationCode: "bar-1", label: "Bar reader" }, pm.userId)).readerId;
  });
  afterAll(() => pool.end());

  const orders = async (billId: string) => (await pool.query(`select state, lines, ordered_at, signed_at, voided_line_id from ${s()}.fiscal_orders where bill_id = $1 order by ordered_at, created_at`, [billId])).rows;

  it("an order round is signed as an order within 45 seconds; a void is a new negative order; the Receipt carries the table key", async () => {
    const b = await openOutletBill(pool, s(), bar, { tableId: null, label: "" }, mia);
    const line = await addBillItem(pool, s(), b, { menuItemId: pils, quantity: 2, modifiers: [], note: "" }, mia);
    await sendOrderRound(pool, s(), b, mia);
    expect(await signOutletOrders(pool, s(), deps, { billId: b })).toEqual({ signed: 1, failed: 0 });
    const [o] = await orders(b);
    expect(o).toMatchObject({ state: "signed", lines: [{ quantity: 2, text: "Pils", pricePerUnit: 4.5 }] });
    expect((o.signed_at.getTime() - o.ordered_at.getTime()) / 1000).toBeLessThan(ORDER_SIGN_SECONDS);
    // the TSE got an order (Bestellung) with the bill as its table key
    const signed = [...fiscal.signed.values()].find((t) => t.input.order);
    expect(signed?.input).toMatchObject({ order: { lineItems: [{ quantity: "2", text: "Pils", pricePerUnit: "4.50" }] }, metadata: { table_key: b } });
    await voidBillLine(pool, s(), b, line, "spilled", pm);
    await signOutletOrders(pool, s(), deps, { billId: b });
    expect((await orders(b)).map((x) => [x.state, x.lines[0].quantity])).toEqual([
      ["signed", 2],
      ["signed", -2],
    ]);
  });

  it("offline: two orders and a cash payment are applied once each, in order, then signed; the Receipt says it was issued offline", async () => {
    const billId = randomUUID();
    const [l1, l2, r1, r2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const t0 = Date.now() - 10 * 60_000;
    const at = (min: number) => new Date(t0 + min * 60_000).toISOString();
    const ops: OutletOp[] = [
      { opId: randomUUID(), at: at(0), kind: "open_bill", billId, tableId: null, label: "Terrasse" },
      { opId: randomUUID(), at: at(1), kind: "add_item", billId, lineId: l1, menuItemId: pils, quantity: 1, modifiers: [], note: "" },
      { opId: randomUUID(), at: at(1), kind: "send_round", billId, roundId: r1, lineIds: [l1] },
      { opId: randomUUID(), at: at(5), kind: "add_item", billId, lineId: l2, menuItemId: pils, quantity: 2, modifiers: [], note: "" },
      { opId: randomUUID(), at: at(5), kind: "send_round", billId, roundId: r2, lineIds: [l2] },
      { opId: randomUUID(), at: at(9), kind: "pay_cash", billId, customerName: "" },
    ];
    // the TSE was down meanwhile as far as the device knew; back online the device sends it all
    const results = await applyOutletOps(pool, s(), bar, "tablet-1", ops, mia);
    expect(results.every((r) => r.ok && !r.repeated)).toBe(true);
    // sent twice (the answer was lost): nothing done again
    expect((await applyOutletOps(pool, s(), bar, "tablet-1", ops, mia)).every((r) => r.repeated)).toBe(true);
    const view = await outletBill(pool, s(), billId, mia);
    expect(view).toMatchObject({ status: "paid", total: 13.5 });
    const receipt = (await receiptByToken(pool, s(), results.at(-1)!.receiptToken!))!;
    expect(receipt.issuedOfflineAt?.toISOString()).toBe(at(9));
    expect(receipt.outletSale?.firstOrderAt?.toISOString()).toBe(at(1));
    // signed after the sync, the orders in the order they were taken, then the Receipt
    await signOutletOrders(pool, s(), deps, { billId });
    expect((await orders(billId)).map((o) => [o.state, o.lines[0].quantity, o.ordered_at.toISOString()])).toEqual([
      ["signed", 1, at(1)],
      ["signed", 2, at(5)],
    ]);
    expect((await signReceipt(pool, s(), deps, receipt.id)).state).toBe("signed");
  });

  it("an offline Room Charge for a guest no longer on the list is refused when checked and left for staff", async () => {
    const snap = await outletSnapshot(pool, s(), bar, mia);
    expect(snap.inHouse.map((g) => g.lastName)).toEqual(["Tanaka"]);
    // the guest checks out while the bar is offline
    await pool.query(`update ${s()}.reservations set status = 'checked_out' where id = $1`, [guest]);
    const billId = randomUUID();
    const line = randomUUID();
    const ops: OutletOp[] = [
      { opId: randomUUID(), at: new Date().toISOString(), kind: "open_bill", billId, tableId: null, label: "" },
      { opId: randomUUID(), at: new Date().toISOString(), kind: "add_item", billId, lineId: line, menuItemId: pils, quantity: 1, modifiers: [], note: "" },
      { opId: randomUUID(), at: new Date().toISOString(), kind: "send_round", billId, roundId: randomUUID(), lineIds: [line] },
      { opId: randomUUID(), at: new Date().toISOString(), kind: "room_charge", billId, reservationId: guest, signature: null },
    ];
    const results = await applyOutletOps(pool, s(), bar, "tablet-1", ops, mia);
    expect(results.at(-1)).toMatchObject({ ok: false, error: "The guest is not checked in" });
    const row = (await pool.query(`select status, offline_problem from ${s()}.outlet_bills where id = $1`, [billId])).rows[0];
    expect(row).toEqual({ status: "open", offline_problem: "Room Charge offline refused when checked: The guest is not checked in" });
    expect((await outletSnapshot(pool, s(), bar, mia)).inHouse).toEqual([]);
    await pool.query(`update ${s()}.reservations set status = 'checked_in' where id = $1`, [guest]);
  });

  it("a card taken offline on a reader is at the hotel's risk, not refunded until forwarded, then on the connected account", async () => {
    const b = await openOutletBill(pool, s(), bar, { tableId: null, label: "" }, mia);
    await addBillItem(pool, s(), b, { menuItemId: pils, quantity: 2, modifiers: [], note: "" }, mia);
    await sendOrderRound(pool, s(), b, mia);
    const p = await startOutletCardPayment(pool, s(), payments, b, { readerId: reader, tip: 0 }, mia);
    await simulateCard(pool, s(), payments, { paymentId: p.id }, { offline: true });
    const taken = await syncPayment(pool, s(), payments, p.id);
    expect(taken).toMatchObject({ status: "succeeded", collectedOffline: true, forwarded: false });
    expect((await outletBill(pool, s(), b, mia)).status).toBe("paid");
    await expect(refundPayment(pool, s(), payments, { paymentId: p.id, amount: 9, reason: "wrong" }, { userId: pm.userId, unlimited: true })).rejects.toThrow(/not forwarded/);
    const intent = (await pool.query(`select provider_intent_id from ${s()}.payments where id = $1`, [p.id])).rows[0].provider_intent_id;
    payments.forwardOffline(intent);
    expect(await syncPayment(pool, s(), payments, p.id)).toMatchObject({ status: "succeeded", forwarded: true });
    expect(payments.intents.get(intent)).toMatchObject({ status: "succeeded", received: 9 });
  });
});
