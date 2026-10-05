import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { FakeAtFiscalProvider, FakeFiscalProvider } from "@hoteloftware/fiscal";
import { FakePaymentProvider } from "@hoteloftware/payments";
import { LocalFileStore } from "@hoteloftware/storage";
import { AT_OUTAGE_NOTICE, addDays, todayIn } from "@hoteloftware/domain";
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
import { checkIn, postServiceCharge } from "../src/tenant/folios";
import { refundPayment, takePayment } from "../src/tenant/payments";
import { createCashRegister, openShift, receiptByToken, setCashDesk } from "../src/tenant/cash";
import { receiptsToSign, signReceipt } from "../src/tenant/fiscal";
import { atDepArchive, atFiscalStatus, atOutagesToReport, atSystemReceipts, markOutageReported, markSystemReceiptPrinted, registerAtClients, setUpFiscalAt, syncAtSystemReceipts, yearlyReceiptsToCheck } from "../src/tenant/fiscal-at";
import { fiscalArchiveFile } from "../src/tenant/fiscal";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams (Austria): the Legal Entity's signature unit is set up with the
 * FinanzOnline credentials; every on-site payment is signed, a refund as a
 * cancellation receipt naming the original; a provider out of reach leaves
 * the Receipt marked and signs it later, and an outage over 48 hours is
 * reminded for reporting; the monthly and yearly receipts are kept, the
 * yearly one reminded until printed and checked; the DEP is exported.
 */
describe("Fiscal module Austria", () => {
  let pool: Pool;
  let tenant: Tenant;
  let wien = "";
  let le = "";
  let res = "";
  const fd = "user_frida";
  const today = todayIn("Europe/Vienna");
  const at = new FakeAtFiscalProvider();
  const deps = { provider: new FakeFiscalProvider(), at, secret: "a-test-fiscal-secret" };
  const payments = new FakePaymentProvider();
  const s = () => tenant.schemaName;
  const asFd = () => ({ userId: fd, actor: { propertyRoles: [{ propertyId: wien, role: "front_desk" as const }] } });
  const receiptOf = async (paymentId: string) => (await pool.query<{ id: string; token: string }>(`select id, token from ${s()}.receipts where payment_id = $1`, [paymentId])).rows[0]!;
  const setUp = { apiKey: "key_at", apiSecret: "secret_at", fon: { participantId: "123456789", userId: "hotelws1", pin: "fonpin1" } };

  beforeAll(async () => {
    pool = testPool(6);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    le = (await createLegalEntity(pool, s(), { name: "Donau GmbH", country: "AT", addressLine1: "Ring 1", postalCode: "1010", city: "Wien", vatId: "ATU12345678", taxNumber: "12-345/6789" })).id;
    wien = (await createProperty(pool, s(), { name: "Hotel Donau", legalEntityId: le, country: "AT", timeZone: "Europe/Vienna", currency: "EUR" })).id;
    const dbl = (await createRoomType(pool, s(), { propertyId: wien, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    await createRooms(pool, s(), { propertyId: wien, roomTypeId: dbl, numbers: ["101"] });
    await applyTaxPreset(pool, s(), le, "AT");
    const codes = await listTaxCodes(pool, s(), le);
    const minibar = await createService(pool, s(), { propertyId: wien, code: "MINI", name: "Minibar", defaultPrice: 120, taxCodeId: codes.find((c) => c.code === "STD")!.id, revenueAccount: "4000", postingRhythm: "once", bookableOnline: false });
    const room = await createService(pool, s(), { propertyId: wien, code: "ROOM", name: "Nächtigung", defaultPrice: 0, taxCodeId: codes.find((c) => c.code === "ACC")!.id, revenueAccount: "4100", postingRhythm: "per_night", bookableOnline: false });
    const pay = await createPaymentPolicy(pool, s(), { propertyId: wien, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId: wien, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s(), { propertyId: wien, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), wien, fd, [{ ratePlanId: plan.id, roomTypeId: dbl, date: today, price: 110 }]);
    const guest = (await createGuest(pool, s(), { firstName: "Anna", lastName: "Huber" }, { userId: fd, propertyId: wien })).id;
    res = (await createBooking(pool, s(), wien, fd, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: addDays(today, 1), roomTypeId: dbl, ratePlanId: plan.id, adults: 1, childAges: [], primaryGuestId: guest }] })).reservations[0]!.id;
    await pool.query(`update ${s()}.rooms set cleanliness = 'inspected'`);
    await pool.query(`insert into ${s()}.room_assignments (reservation_id, room_id, from_date, to_date) select $1, id, $2, $3 from ${s()}.rooms`, [res, today, addDays(today, 1)]);
    await checkIn(pool, s(), res, fd);
    await postServiceCharge(pool, s(), res, { serviceId: minibar.id, quantity: 1 }, fd);
    await setCashDesk(pool, s(), wien, { enabled: true, tolerance: 5, paidOutLimit: 100, differenceAccount: "2700" });
  });
  afterAll(() => pool.end());

  it("the signature unit is set up with the FinanzOnline credentials; the registers are registered with their start receipt", async () => {
    await expect(setUpFiscalAt(pool, s(), deps, le, { ...setUp, fon: { ...setUp.fon, participantId: "x" } }, "user_pm")).rejects.toThrow(/FinanzOnline/);
    await setUpFiscalAt(pool, s(), deps, le, setUp, "user_pm");
    await setUpFiscalAt(pool, s(), deps, le, setUp, "user_pm");
    expect(at.fon.get("key_at")).toMatchObject({ participantId: "123456789" });
    const front = await createCashRegister(pool, s(), wien, "Rezeption 1");
    expect(await registerAtClients(pool, s(), deps, wien)).toEqual({ registered: 1, failed: [] });
    const st = (await atFiscalStatus(pool, s(), wien))!;
    expect(st.unit).toMatchObject({ fonParticipantId: "123456789" });
    expect(st.registers.every((r) => r.providerSerial && r.initializationReceiptId)).toBe(true);
    // the PIN and the API secret are kept sealed
    const u = (await pool.query(`select api_secret_sealed, fon_pin_sealed from ${s()}.fiscal_at_units`)).rows[0];
    expect(`${u.api_secret_sealed}${u.fon_pin_sealed}`).not.toMatch(/secret_at|fonpin1/);
    await openShift(pool, s(), { registerId: front, count: { "50": 4 } }, asFd());
  });

  it("every payment is signed; a refund is a cancellation receipt naming the original", async () => {
    // the folio: 110 at 10 % (the night), 120 at 20 % (minibar)
    const paid = await takePayment(pool, s(), payments, { reservationId: res, tender: "cash", amount: 230 }, fd);
    const rc = await receiptOf(paid.id);
    expect(await signReceipt(pool, s(), deps, rc.id)).toMatchObject({ state: "signed" });
    const sent = at.signed.get(rc.id)!.input;
    expect(sent.type).toBe("NORMAL");
    expect(sent.amountsPerVatRate).toEqual([{ vatRate: "STANDARD", amount: "120.00" }, { vatRate: "REDUCED_1", amount: "110.00" }]);
    const view = await receiptByToken(pool, s(), rc.token);
    expect(view?.fiscal).toMatchObject({ state: "at_signed", receiptNumber: "2", qrCodeData: expect.stringMatching(/^_R1-AT1_/), unitFailed: false, cancellation: false });
    const back = await refundPayment(pool, s(), payments, { paymentId: paid.id, amount: 23, reason: "Minibar" }, { userId: fd, unlimited: true });
    const cancel = await receiptOf(back.id);
    expect(await signReceipt(pool, s(), deps, cancel.id)).toMatchObject({ state: "signed" });
    expect(at.signed.get(cancel.id)!.input).toMatchObject({ type: "CANCELLATION", metadata: { cancels_receipt_number: "2" } });
    expect((await receiptByToken(pool, s(), cancel.token))?.fiscal).toMatchObject({ state: "at_signed", cancellation: true });
  });

  it("the provider out of reach: the Receipt says so and is signed later; an outage over 48 hours is reminded for reporting", async () => {
    at.down = true;
    const rc = await receiptOf((await takePayment(pool, s(), payments, { reservationId: res, tender: "cash", amount: 10 }, fd)).id);
    expect(await signReceipt(pool, s(), deps, rc.id)).toMatchObject({ state: "failed", outageStarted: true });
    expect((await receiptByToken(pool, s(), rc.token))?.fiscal).toMatchObject({ state: "at_unsigned", notice: AT_OUTAGE_NOTICE });
    // tried again after a minute's back-off
    expect(await receiptsToSign(pool, s())).not.toContain(rc.id);
    await pool.query(`update ${s()}.fiscal_transactions set claimed_at = now() - interval '2 minutes' where receipt_id = $1`, [rc.id]);
    expect(await receiptsToSign(pool, s())).toContain(rc.id);
    expect(await atOutagesToReport(pool, s())).toEqual([]);
    // two days and an hour later, still out
    const later = new Date(Date.now() + 49 * 3_600_000);
    const due = await atOutagesToReport(pool, s(), later);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ propertyName: "Hotel Donau", endedAt: null });
    expect(due[0]!.reportBy.getTime() - due[0]!.startedAt.getTime()).toBe((48 + 7 * 24) * 3_600_000);
    // reminded at most once a day
    expect(await atOutagesToReport(pool, s(), new Date(later.getTime() + 3_600_000))).toEqual([]);
    await markOutageReported(pool, s(), wien, due[0]!.id, "user_pm");
    expect(await atOutagesToReport(pool, s(), new Date(later.getTime() + 2 * 86_400_000))).toEqual([]);
    // back: signed now, the outage ends
    at.down = false;
    expect(await signReceipt(pool, s(), deps, rc.id)).toMatchObject({ state: "signed" });
    expect((await atFiscalStatus(pool, s(), wien))!.outages[0]!.endedAt).not.toBeNull();
    // the signature unit itself out: the receipt comes back marked; the outage is logged, reported by the provider
    at.scuDown = true;
    const scu = await receiptOf((await takePayment(pool, s(), payments, { reservationId: res, tender: "cash", amount: 5 }, fd)).id);
    expect(await signReceipt(pool, s(), deps, scu.id)).toMatchObject({ state: "failed", outageStarted: true });
    expect((await receiptByToken(pool, s(), scu.token))?.fiscal).toMatchObject({ state: "at_signed", unitFailed: true });
    expect((await atFiscalStatus(pool, s(), wien))!.outages[0]).toMatchObject({ endedAt: null, reportedAt: expect.any(Date) });
    at.scuDown = false;
    await signReceipt(pool, s(), deps, (await receiptOf((await takePayment(pool, s(), payments, { reservationId: res, tender: "cash", amount: 1 }, fd)).id)).id);
    expect((await atFiscalStatus(pool, s(), wien))!.outages[0]!.endedAt).not.toBeNull();
    // a receipt the provider will not sign: refused for good, never retried, no outage
    at.refuse = true;
    const bad = await receiptOf((await takePayment(pool, s(), payments, { reservationId: res, tender: "cash", amount: 2 }, fd)).id);
    expect(await signReceipt(pool, s(), deps, bad.id)).toMatchObject({ state: "refused", newly: true });
    at.refuse = false;
    expect(await receiptsToSign(pool, s())).not.toContain(bad.id);
    expect((await receiptByToken(pool, s(), bad.token))?.fiscal).toMatchObject({ state: "at_unsigned", notice: expect.stringMatching(/nicht signiert/) });
  });

  it("the monthly and yearly receipts are kept; the yearly one is reminded until printed and checked", async () => {
    for (const r of at.registers.values()) r.created = new Date(Date.UTC(2025, 10, 10));
    await syncAtSystemReceipts(pool, s(), deps, wien);
    const list = await atSystemReceipts(pool, s(), wien);
    expect(list.filter((r) => r.type === "MONTHLY_CLOSE").length).toBeGreaterThan(0);
    const yearly = list.filter((r) => r.type === "YEARLY_CLOSE");
    expect(yearly.length).toBeGreaterThan(0);
    expect(yearly[0]).toMatchObject({ checkBy: "2026-02-15", validation: "SUCCESS" });
    const todo = await yearlyReceiptsToCheck(pool, s());
    expect(todo.length).toBe(yearly.length);
    for (const y of yearly) await markSystemReceiptPrinted(pool, s(), wien, y.id, "user_pm");
    expect(await yearlyReceiptsToCheck(pool, s())).toEqual([]);
  });

  it("the data collection log (DEP7) of the registers is exported", async () => {
    const store = new LocalFileStore(await mkdtemp(join(tmpdir(), "dep-")));
    const a = await atDepArchive(pool, s(), { ...deps, store, tenantId: tenant.id }, { propertyId: wien, from: addDays(today, -1), to: addDays(today, 1) }, "user_pm");
    expect(a.state).toBe("completed");
    const file = JSON.parse(new TextDecoder().decode((await fiscalArchiveFile(pool, s(), store, a.id!))!.bytes));
    expect(Object.values(file).some((dep) => (dep as { "Belege-Gruppe": { "Belege-kompakt": string[] }[] })["Belege-Gruppe"][0]!["Belege-kompakt"].length > 0)).toBe(true);
  });
});
