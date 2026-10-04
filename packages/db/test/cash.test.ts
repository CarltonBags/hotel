import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { FakePaymentProvider } from "@hoteloftware/payments";
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
import { loadFolios, postServiceCharge } from "../src/tenant/folios";
import { ApprovalRequired } from "../src/tenant/approvals";
import { refundPayment, takePayment } from "../src/tenant/payments";
import { OpeningDifference, cashBook, closeShiftWithReason, createCashRegister, listCashRegisters, myOpenShift, openShift, receiptByToken, receiptsOfReservation, recordCashMovement, setCashDesk, submitCloseCount } from "../src/tenant/cash";
import { nightAuditView } from "../src/tenant/night-audit";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: the cash desk — Shifts opened with a counted float and closed with a
 * blind count, cash payments and refunds in the Cash Book with Receipts,
 * Paid-outs within the limit or with Approval, the Night Audit's warning.
 */
describe("cash desk", () => {
  let pool: Pool;
  let tenant: Tenant;
  let le: string;
  let berlin: string;
  let res: string;
  let front: string;
  let bar: string;
  const asFd = () => ({ userId: fd, actor: { propertyRoles: [{ propertyId: berlin, role: "front_desk" as const }] } });
  const asPm = () => ({ userId: "user_pm", actor: { propertyRoles: [{ propertyId: berlin, role: "property_manager" as const }] } });
  const s = () => tenant.schemaName;
  const PHOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const provider = new FakePaymentProvider();
  const fd = "user_frida";
  const today = todayIn("Europe/Berlin");
  const asFrontDesk = { userId: fd, unlimited: false };
  const asManager = { userId: "user_pm", unlimited: true };

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const s = tenant.schemaName;
    le = (await createLegalEntity(pool, s, { name: "Alpha GmbH", country: "DE", addressLine1: "Unter den Linden 1", postalCode: "10117", city: "Berlin", vatId: "DE123456789", taxNumber: "27/123/45678" })).id;
    berlin = (await createProperty(pool, s, { name: "Berlin", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    const dbl = (await createRoomType(pool, s, { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    await createRooms(pool, s, { propertyId: berlin, roomTypeId: dbl, numbers: ["101"] });
    await applyTaxPreset(pool, s, le, "DE");
    const std = (await listTaxCodes(pool, s, le)).find((c) => c.code === "STD")!.id;
    const minibar = await createService(pool, s, { propertyId: berlin, code: "MINI", name: "Minibar", defaultPrice: 100, taxCodeId: std, revenueAccount: "8410", postingRhythm: "once", bookableOnline: false });
    const room = await createService(pool, s, { propertyId: berlin, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: (await listTaxCodes(pool, s, le)).find((c) => c.code === "ACC")!.id, revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const pay = await createPaymentPolicy(pool, s, { propertyId: berlin, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s, { propertyId: berlin, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s, { propertyId: berlin, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s, berlin, fd, [{ ratePlanId: plan.id, roomTypeId: dbl, date: today, price: 100 }]);
    const guest = (await createGuest(pool, s, { firstName: "Aiko", lastName: "Tanaka" }, { userId: fd, propertyId: berlin })).id;
    const b = await createBooking(pool, s, berlin, fd, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: addDays(today, 1), roomTypeId: dbl, ratePlanId: plan.id, adults: 1, childAges: [], primaryGuestId: guest }] });
    res = b.reservations[0]!.id;
    // a balance of 400 on the guest's folio
    await postServiceCharge(pool, s, res, { serviceId: minibar.id, quantity: 4 }, fd);
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("refuses cash while the cash desk is off, and without an open Shift", async () => {
    await expect(takePayment(pool, s(), provider, { reservationId: res, tender: "cash", amount: 10 }, fd)).rejects.toThrow(/cash desk is off/);
    await expect(setCashDesk(pool, s(), berlin, { enabled: true, tolerance: 5, paidOutLimit: 100, differenceAccount: "" })).rejects.toThrow(/cash-difference account/);
    await setCashDesk(pool, s(), berlin, { enabled: true, tolerance: 5, paidOutLimit: 100, differenceAccount: "1370" });
    front = await createCashRegister(pool, s(), berlin, "Front desk 1");
    bar = await createCashRegister(pool, s(), berlin, "Bar");
    await expect(takePayment(pool, s(), provider, { reservationId: res, tender: "cash", amount: 10 }, fd)).rejects.toThrow(/Open your Shift/);
  });

  it("the Cash Book balance equals the float plus the movements, with a Receipt for each cash payment", async () => {
    // 200.00 float: four 50 notes
    await openShift(pool, s(), { registerId: front, count: { "50": 4 } }, asFd());
    await expect(openShift(pool, s(), { registerId: bar, count: {} }, asFd())).rejects.toThrow(/open Shift on another register/);
    const paid = await takePayment(pool, s(), provider, { reservationId: res, tender: "cash", amount: 120.5 }, fd);
    await refundPayment(pool, s(), provider, { paymentId: paid.id, amount: 20, reason: "Minibar item returned" }, asFrontDesk);
    // the desk sees its movements but no balance before its blind count
    const desk = await cashBook(pool, s(), front, asFd());
    expect(desk.rows.map((r) => [r.kind, r.amount, r.balance])).toEqual([
      ["float", 200, null],
      ["payment", 120.5, null],
      ["refund", -20, null],
    ]);
    expect(desk.balance).toBeNull();
    const book = await cashBook(pool, s(), front, asPm());
    expect(book.rows.map((r) => [r.kind, r.amount, r.balance])).toEqual([
      ["float", 200, 200],
      ["payment", 120.5, 320.5],
      ["refund", -20, 300.5],
    ]);
    expect(book.balance).toBe(300.5);
    expect((await listCashRegisters(pool, s(), berlin)).find((r) => r.id === front)?.balance).toBe(300.5);
    const receipts = await receiptsOfReservation(pool, s(), res);
    expect(Object.values(receipts).map((r) => r.number).sort()).toEqual([1, 2]);
    const receipt = await receiptByToken(pool, s(), receipts[paid.id]!.token);
    expect(receipt).toMatchObject({ number: 1, amount: 120.5, tender: "cash", refund: false, guestName: "A. Tanaka", legalEntity: { name: "Alpha GmbH", vatId: "DE123456789" } });
    // Cash Book entries are never changed
    await expect(pool.query(`update ${s()}.cash_movements set amount = 0`)).rejects.toThrow(/never changed/);
  });

  it("a Paid-out above the property limit needs an Approval", async () => {
    await expect(recordCashMovement(pool, s(), { kind: "paid_out", registerId: front, amount: 30, reason: "Flowers", account: "4980" }, asFd())).rejects.toThrow(/photo/);
    await recordCashMovement(pool, s(), { kind: "paid_out", registerId: front, amount: 30, reason: "Flowers", account: "4980", photo: PHOTO }, asFd());
    await expect(recordCashMovement(pool, s(), { kind: "paid_out", registerId: front, amount: 150, reason: "Repair", account: "4800", photo: PHOTO }, asFd())).rejects.toBeInstanceOf(ApprovalRequired);
    // a Property Manager approves on the same screen
    await recordCashMovement(pool, s(), { kind: "paid_out", registerId: front, amount: 150, reason: "Repair", account: "4800", photo: PHOTO }, { ...asFd(), approverId: "user_pm" });
    const book = await cashBook(pool, s(), front, asPm());
    expect(book.rows.slice(-2).map((r) => [r.kind, r.amount, r.approvedBy])).toEqual([
      ["paid_out", -30, null],
      ["paid_out", -150, "user_pm"],
    ]);
    expect(book.balance).toBe(120.5);
    // the desk cannot deposit to the bank; the Property Manager can
    await expect(recordCashMovement(pool, s(), { kind: "deposit", registerId: front, amount: 10, reason: "Bank" }, asFd())).rejects.toThrow(/Not allowed/);
  });

  it("the Night Audit warns about open Shifts", async () => {
    const view = await nightAuditView(pool, s(), berlin);
    expect(view.warnings.openShifts).toEqual([expect.objectContaining({ registerName: "Front desk 1", userId: fd })]);
  });

  it("blind count: the expected amount comes only with the count; above the tolerance a reason closes the Shift", async () => {
    const shift = (await myOpenShift(pool, s(), berlin, fd))!;
    expect(shift.count).toBeNull();
    // 120.50 expected; 110.00 counted
    const r = await submitCloseCount(pool, s(), { shiftId: shift.id, count: { "100": 1, "10": 1 } }, asFd());
    expect(r).toEqual({ expected: 120.5, counted: 110, difference: -10.5, needsReason: true, closed: false });
    // counted for closing: no cash moves until it is closed
    await expect(recordCashMovement(pool, s(), { kind: "tip_out", registerId: front, amount: 5, reason: "Anna" }, asFd())).rejects.toThrow(/counted for closing/);
    await expect(recordCashMovement(pool, s(), { kind: "deposit", registerId: front, amount: 5, reason: "Bank" }, asPm())).rejects.toThrow(/counted for closing/);
    // the count stays as entered
    await expect(submitCloseCount(pool, s(), { shiftId: shift.id, count: { "100": 1, "20": 1, "0.5": 1 } }, asFd())).rejects.toThrow(/entered already/);
    await expect(closeShiftWithReason(pool, s(), { shiftId: shift.id, reason: " " }, asFd())).rejects.toThrow(/why/);
    const closed = await closeShiftWithReason(pool, s(), { shiftId: shift.id, reason: "Change given wrongly" }, asFd());
    expect(closed.difference).toBe(-10.5);
    const book = await cashBook(pool, s(), front, asPm());
    expect(book.rows.at(-1)).toMatchObject({ kind: "difference", amount: -10.5, account: "1370", reason: "Change given wrongly" });
    expect(book.balance).toBe(110);
    expect(await myOpenShift(pool, s(), berlin, fd)).toBeNull();
    // an opening count off by more than the tolerance needs a reason
    await expect(openShift(pool, s(), { registerId: front, count: { "100": 1 } }, asFd())).rejects.toBeInstanceOf(OpeningDifference);
    // the next Shift starts from what is really there; within tolerance it closes at once
    await openShift(pool, s(), { registerId: front, count: { "100": 1, "10": 1 } }, asFd());
    const next = (await myOpenShift(pool, s(), berlin, fd))!;
    expect(await submitCloseCount(pool, s(), { shiftId: next.id, count: { "100": 1, "5": 1, "2": 1 } }, asFd())).toEqual({ expected: 110, counted: 107, difference: -3, needsReason: false, closed: true });
    expect((await nightAuditView(pool, s(), berlin)).warnings.openShifts).toEqual([]);
    // a closed Shift and a Receipt stay as they are
    await expect(pool.query(`update ${s()}.cash_shifts set reason = 'x' where id = $1`, [next.id])).rejects.toThrow(/not changed/);
    await expect(pool.query(`update ${s()}.receipts set number = 99`)).rejects.toThrow(/never changed/);
  });
});
