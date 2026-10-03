import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { FakePaymentProvider } from "@hoteloftware/payments";
import { addDays, todayIn } from "@hoteloftware/domain";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms, updateRoomType, type Room } from "../src/tenant/rooms";
import { applyTaxPreset, listTaxCodes } from "../src/tenant/tax-codes";
import { createService } from "../src/tenant/services";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan, type RatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createBooking } from "../src/tenant/reservations";
import { assignRoom, reservationHistory } from "../src/tenant/reservation-changes";
import { checkIn, loadFolios, postServiceCharge, voidCharge } from "../src/tenant/folios";
import { refundPayment, takePayment } from "../src/tenant/payments";
import { ApprovalRequired, decideApproval, listApprovals, requestApproval } from "../src/tenant/approvals";
import { overrideNightPrices } from "../src/tenant/price-override";
import { auditLog } from "../src/tenant/audit-log";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: an action beyond a role's limit refused with an Approval request,
 * allowed once after the Property Manager's consent (remote or on the same
 * screen), recorded with both names; expiry; Price Override against the
 * Price Floor; the property-wide audit log.
 */
describe("approvals, Price Override and the audit log", () => {
  let pool: Pool;
  let tenant: Tenant;
  let berlin: string;
  let dbl: string;
  let rooms: Room[];
  let plan: RatePlan;
  let guest: string;
  let minibar: string;
  let nextRoom = 0;
  const provider = new FakePaymentProvider();
  const fd = "user_frida";
  const pm = "user_paula";
  const today = todayIn("Europe/Berlin");
  const day = (n: number) => addDays(today, n);
  const s = () => tenant.schemaName;
  const book = async (nights = 2) =>
    (await createBooking(pool, s(), berlin, fd, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: day(nights), roomTypeId: dbl, ratePlanId: plan.id, adults: 2, childAges: [], primaryGuestId: guest }] }))
      .reservations[0]!.id;
  const paid = async (amount: number) => {
    const res = await book();
    const p = await takePayment(pool, s(), provider, { reservationId: res, tender: "bank_transfer", amount, reference: "transfer" }, fd);
    return { res, payment: p.id };
  };
  const refund = (paymentId: string, amount: number, approverId?: string) =>
    refundPayment(pool, s(), provider, { paymentId, amount, reason: "guest complaint" }, { userId: fd, unlimited: false, approverId: approverId ?? null });
  const refused = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (err) {
      return err;
    }
    throw new Error("expected a refusal");
  };

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "Alpha GmbH", country: "DE", addressLine1: "Unter den Linden 1", postalCode: "10117", city: "Berlin", vatId: "DE123456789", taxNumber: "27/123/45678" })).id;
    berlin = (await createProperty(pool, s(), { name: "Berlin", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    dbl = (await createRoomType(pool, s(), { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0, priceFloor: 80 })).id;
    rooms = await createRooms(pool, s(), { propertyId: berlin, roomTypeId: dbl, numbers: Array.from({ length: 20 }, (_, i) => String(101 + i)) });
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const id = (c: string) => codes.find((x) => x.code === c)!.id;
    const room = await createService(pool, s(), { propertyId: berlin, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: id("ACC"), revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const brk = await createService(pool, s(), { propertyId: berlin, code: "BRK", name: "Frühstück", defaultPrice: 12, taxCodeId: id("FOOD"), revenueAccount: "8400", postingRhythm: "per_person_night", bookableOnline: false });
    minibar = (await createService(pool, s(), { propertyId: berlin, code: "MINI", name: "Minibar", defaultPrice: 9.5, taxCodeId: id("STD"), revenueAccount: "8410", postingRhythm: "once", bookableOnline: false })).id;
    const pay = await createPaymentPolicy(pool, s(), { propertyId: berlin, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId: berlin, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    plan = await createRatePlan(pool, s(), { propertyId: berlin, code: "BB", name: "Bed and breakfast", kind: "base", roomTypeIds: [dbl], mealPlan: "breakfast", accommodationServiceId: room.id, includedServices: [{ serviceId: brk.id, componentPrice: 12 }], paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), berlin, fd, Array.from({ length: 10 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: day(n), price: 120 })));
    guest = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka", addressLine1: "1-2-3 Shibuya", postalCode: "150-0002", city: "Tokyo", countryOfResidence: "JP" }, { userId: fd, propertyId: berlin })).id;
    void updateRoomType;
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("a refund above the limit is refused, then allowed once after a remote Approval, recorded with both names", async () => {
    const { payment } = await paid(500);
    const err = await refused(refund(payment, 300));
    expect(err).toBeInstanceOf(ApprovalRequired);
    const request = await requestApproval(pool, s(), (err as ApprovalRequired).subject, fd);
    expect((await listApprovals(pool, s(), berlin)).find((a) => a.id === request.id)).toMatchObject({ kind: "refund_over_limit", status: "pending", requestedBy: fd });
    // still refused while pending
    await expect(refund(payment, 300)).rejects.toBeInstanceOf(ApprovalRequired);
    await decideApproval(pool, s(), request.id, { approve: true, note: "" }, pm);
    const r = await refund(payment, 300);
    const { rows } = await pool.query(`select posted_by, approved_by from ${s()}.payments where id = $1`, [r.id]);
    expect(rows[0]).toEqual({ posted_by: fd, approved_by: pm });
    expect((await listApprovals(pool, s(), berlin)).find((a) => a.id === request.id)).toMatchObject({ status: "used", decidedBy: pm });
    // used once: another refund above the limit needs a new Approval
    await expect(refund(payment, 150)).rejects.toBeInstanceOf(ApprovalRequired);
  });

  it("an Approval given on the same screen is recorded as granted and used at once", async () => {
    const { payment } = await paid(400);
    const r = await refund(payment, 300, pm);
    expect((await pool.query(`select approved_by from ${s()}.payments where id = $1`, [r.id])).rows[0].approved_by).toBe(pm);
    expect((await listApprovals(pool, s(), berlin)).some((a) => a.status === "used" && a.decidedBy === pm && a.summary.includes("300.00"))).toBe(true);
  });

  it("an expired Approval request can neither be approved nor used", async () => {
    const { payment } = await paid(500);
    const err = (await refused(refund(payment, 250))) as ApprovalRequired;
    const old = await requestApproval(pool, s(), err.subject, fd);
    await pool.query(`update ${s()}.approvals set expires_at = now() - interval '1 minute' where id = $1`, [old.id]);
    await expect(decideApproval(pool, s(), old.id, { approve: true, note: "" }, pm)).rejects.toThrow(/expired/);
    const late = await requestApproval(pool, s(), err.subject, fd);
    await decideApproval(pool, s(), late.id, { approve: true, note: "" }, pm);
    await pool.query(`update ${s()}.approvals set expires_at = now() - interval '1 minute' where id = $1`, [late.id]);
    await expect(refund(payment, 250)).rejects.toBeInstanceOf(ApprovalRequired);
    expect((await listApprovals(pool, s(), berlin)).find((a) => a.id === late.id)?.status).toBe("expired");
  });

  it("a Price Override below the floor without Approval is refused; complimentary needs a reason", async () => {
    const res = await book();
    // at or above the floor (80) Front Desk changes the price with a reason
    await overrideNightPrices(pool, s(), res, { nights: [{ date: today, price: 100 }], reason: "loyal guest" }, { userId: fd, canApprove: false });
    await expect(overrideNightPrices(pool, s(), res, { nights: [{ date: today, price: 90 }], reason: " " }, { userId: fd, canApprove: false })).rejects.toThrow(/reason/);
    await expect(overrideNightPrices(pool, s(), res, { nights: [{ date: today, price: 70 }], reason: "deal" }, { userId: fd, canApprove: false })).rejects.toBeInstanceOf(ApprovalRequired);
    await expect(overrideNightPrices(pool, s(), res, { nights: [{ date: day(1), price: 0 }], reason: "" }, { userId: pm, canApprove: true })).rejects.toThrow(/reason/);
    // the included breakfast (2 × 12) stays: a price below it is refused
    await expect(overrideNightPrices(pool, s(), res, { nights: [{ date: today, price: 20 }], reason: "x" }, { userId: pm, canApprove: true })).rejects.toThrow(/includes Services/);
    await overrideNightPrices(pool, s(), res, { nights: [{ date: day(1), price: 0 }], reason: "anniversary" }, { userId: fd, canApprove: false, approverId: pm });
    const { rows } = await pool.query(`select to_char(date, 'YYYY-MM-DD') as date, total from ${s()}.reservation_nights where reservation_id = $1 order by date`, [res]);
    expect(rows.map((r) => [r.date, Number(r.total)])).toEqual([
      [today, 100],
      [day(1), 0],
    ]);
    const history = await reservationHistory(pool, s(), res);
    expect(history.filter((h) => h.action === "price_override").map((h) => [h.after.reason, h.approvedBy])).toEqual([
      ["anniversary", pm],
      ["loyal guest", null],
    ]);
  });

  it("a checked-in stay's Charges follow the overridden price", async () => {
    const res = await book();
    await assignRoom(pool, s(), res, fd, rooms[nextRoom++]!.id);
    await checkIn(pool, s(), res, fd);
    await overrideNightPrices(pool, s(), res, { nights: [{ date: day(1), price: 104 }], reason: "upgrade refused" }, { userId: fd, canApprove: false });
    const charges = (await loadFolios(pool, s(), res)).folios.flatMap((f) => f.charges).filter((c) => !c.voidedAt && c.serviceDate === day(1));
    expect(charges.reduce((sum, c) => sum + c.amount, 0)).toBe(104);
  });

  it("the audit log lists reservation edits, voids, overrides and approvals; Accounting sees money entries only", async () => {
    const res = await book();
    await assignRoom(pool, s(), res, fd, rooms[nextRoom++]!.id);
    await checkIn(pool, s(), res, fd);
    await postServiceCharge(pool, s(), res, { serviceId: minibar, quantity: 1 }, fd);
    const charge = (await loadFolios(pool, s(), res)).folios[0]!.charges.find((c) => c.description === "Minibar")!;
    await voidCharge(pool, s(), res, charge.id, "not consumed", fd);
    await overrideNightPrices(pool, s(), res, { nights: [{ date: day(1), price: 60 }], reason: "deal" }, { userId: fd, canApprove: false, approverId: pm });
    const all = await auditLog(pool, s(), berlin, { from: today, to: today }, { moneyOnly: false });
    const actions = all.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["check_in", "assign_room", "charge_void", "price_override", "approval_granted", "refund", "approval_requested", "approval_approved"]));
    const override = all.find((e) => e.action === "price_override" && e.recordId === res)!;
    expect(override).toMatchObject({ userId: fd, approvedBy: pm, area: "reservation" });
    const voidEntry = all.find((e) => e.action === "charge_void" && e.recordId === res && e.recordLabel.includes("Minibar"))!;
    expect(voidEntry.detail).toContain("not consumed");
    // filters by user and record
    expect((await auditLog(pool, s(), berlin, { from: today, to: today, userId: pm }, { moneyOnly: false })).every((e) => e.userId === pm)).toBe(true);
    const conf = override.recordLabel;
    expect((await auditLog(pool, s(), berlin, { from: today, to: today, record: conf }, { moneyOnly: false })).every((e) => e.recordLabel.includes(conf))).toBe(true);
    const money = await auditLog(pool, s(), berlin, { from: today, to: today }, { moneyOnly: true });
    expect(money.length).toBeGreaterThan(0);
    expect(money.every((e) => e.area === "money")).toBe(true);
  });
});
