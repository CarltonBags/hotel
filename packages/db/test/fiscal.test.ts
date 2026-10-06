import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { FakeFiscalProvider } from "@hoteloftware/fiscal";
import { FakePaymentProvider } from "@hoteloftware/payments";
import { LocalFileStore } from "@hoteloftware/storage";
import { FISCAL_OUTAGE_NOTICE, addDays, todayIn } from "@hoteloftware/domain";
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
import { closeFiscalDay, fiscalArchive, fiscalArchiveFile, fiscalDaysToClose, fiscalRegistration, fiscalStatus, receiptsToSign, registerFiscalClients, setFiscalScope, setUpFiscal, signReceipt } from "../src/tenant/fiscal";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: the TSE is set up once per German property; a cash Receipt is
 * signed with its VAT per rate and shows the TSE data and QR code; an outage
 * leaves the payment done, the Receipt with the notice, the outage logged
 * from start to end; the Business Date is closed for DSFinV-K with every
 * Receipt; the signed data is archived outside the provider.
 */
describe("Fiscal module Germany", () => {
  let pool: Pool;
  let tenant: Tenant;
  let berlin = "";
  let res = "";
  let front = "";
  const fd = "user_frida";
  const today = todayIn("Europe/Berlin");
  const fiscal = new FakeFiscalProvider();
  const deps = { provider: fiscal, secret: "a-test-fiscal-secret" };
  const payments = new FakePaymentProvider();
  const s = () => tenant.schemaName;
  const asFd = () => ({ userId: fd, actor: { propertyRoles: [{ propertyId: berlin, role: "front_desk" as const }] } });
  const receiptOf = async (paymentId: string) => (await pool.query<{ id: string; token: string }>(`select id, token from ${s()}.receipts where payment_id = $1`, [paymentId])).rows[0]!;

  beforeAll(async () => {
    pool = testPool(6);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "Alpha GmbH", country: "DE", addressLine1: "Unter den Linden 1", postalCode: "10117", city: "Berlin", vatId: "DE123456789", taxNumber: "27/123/45678" })).id;
    berlin = (await createProperty(pool, s(), { name: "Berlin", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    const dbl = (await createRoomType(pool, s(), { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    await createRooms(pool, s(), { propertyId: berlin, roomTypeId: dbl, numbers: ["101"] });
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const minibar = await createService(pool, s(), { propertyId: berlin, code: "MINI", name: "Minibar", defaultPrice: 119, taxCodeId: codes.find((c) => c.code === "STD")!.id, revenueAccount: "8410", postingRhythm: "once", bookableOnline: false });
    const room = await createService(pool, s(), { propertyId: berlin, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: codes.find((c) => c.code === "ACC")!.id, revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const pay = await createPaymentPolicy(pool, s(), { propertyId: berlin, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId: berlin, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s(), { propertyId: berlin, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), berlin, fd, [{ ratePlanId: plan.id, roomTypeId: dbl, date: today, price: 107 }]);
    const guest = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka" }, { userId: fd, propertyId: berlin })).id;
    res = (await createBooking(pool, s(), berlin, fd, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: addDays(today, 1), roomTypeId: dbl, ratePlanId: plan.id, adults: 1, childAges: [], primaryGuestId: guest }] })).reservations[0]!.id;
    await pool.query(`update ${s()}.rooms set cleanliness = 'inspected'`);
    await pool.query(`insert into ${s()}.room_assignments (reservation_id, room_id, from_date, to_date) select $1, id, $2, $3 from ${s()}.rooms`, [res, today, addDays(today, 1)]);
    await checkIn(pool, s(), res, fd);
    await postServiceCharge(pool, s(), res, { serviceId: minibar.id, quantity: 1 }, fd);
  });
  afterAll(() => pool.end());

  it("the TSE is set up once, for a German property with the cash desk on", async () => {
    await expect(setUpFiscal(pool, s(), deps, berlin, "user_pm")).rejects.toThrow(/cash desk on/);
    await setCashDesk(pool, s(), berlin, { enabled: true, tolerance: 5, paidOutLimit: 100, differenceAccount: "1370" });
    const unit = await setUpFiscal(pool, s(), deps, berlin, "user_pm");
    expect(unit).toMatchObject({ provider: "fake", scope: "all", signatureAlgorithm: "ecdsa-plain-SHA256" });
    expect(await setUpFiscal(pool, s(), deps, berlin, "user_pm")).toEqual(unit);
    expect(fiscal.tss.size).toBe(1);
    // the PUK is kept sealed, never in clear
    expect((await pool.query(`select puk_sealed from ${s()}.fiscal_units`)).rows[0].puk_sealed).not.toContain("FAKEPUK");
  });

  it("a cash Receipt is signed with its VAT per rate and shows the TSE data and QR code; signing again changes nothing", async () => {
    front = await createCashRegister(pool, s(), berlin, "Front desk 1");
    await openShift(pool, s(), { registerId: front, count: { "50": 4 } }, asFd());
    // a register added after the set-up: its first Receipt waits until the register is a registered client
    const early = await receiptOf((await takePayment(pool, s(), payments, { reservationId: res, tender: "cash", amount: 1 }, fd)).id);
    expect(await signReceipt(pool, s(), deps, early.id)).toEqual({ state: "signing" });
    expect(await registerFiscalClients(pool, s(), deps, berlin)).toEqual({ registered: 1, failed: [] });
    expect(await signReceipt(pool, s(), deps, early.id)).toMatchObject({ state: "signed" });
    // the folio holds 107 at 7 % (the night) and 119 at 19 % (minibar): 226 paid in cash
    const paid = await takePayment(pool, s(), payments, { reservationId: res, tender: "cash", amount: 226 }, fd);
    const rc = await receiptOf(paid.id);
    expect(await signReceipt(pool, s(), deps, rc.id)).toMatchObject({ state: "signed" });
    expect(await signReceipt(pool, s(), deps, rc.id)).toMatchObject({ state: "signed" });
    expect(fiscal.signed.size).toBe(2);
    const sent = fiscal.signed.get(rc.id)!.input;
    expect(sent.amountsPerVatRate).toEqual([{ vatRate: "NORMAL", amount: "119.00" }, { vatRate: "REDUCED_1", amount: "107.00" }]);
    expect(sent.amountsPerPaymentType).toEqual([{ paymentType: "CASH", amount: "226.00", currency: "EUR" }]);
    const view = await receiptByToken(pool, s(), rc.token);
    expect(view?.fiscal).toMatchObject({ state: "signed", number: 2, signatureCounter: 4, businessCase: "Umsatz", clientSerial: expect.stringMatching(/^HS-[0-9A-F]{32}$/), qrCodeData: expect.stringMatching(/^V0;/) });
    // a signed transaction never changes
    await expect(pool.query(`update ${s()}.fiscal_transactions set signature = 'x'`)).rejects.toThrow(/never changes/);
  });

  it("a refund carries the VAT of the payment it gives back", async () => {
    const paid = await takePayment(pool, s(), payments, { reservationId: res, tender: "cash", amount: 100 }, fd);
    const first = await receiptOf(paid.id);
    expect(await signReceipt(pool, s(), deps, first.id)).toMatchObject({ state: "signed" });
    const back = await refundPayment(pool, s(), payments, { paymentId: paid.id, amount: 50, reason: "Overpaid" }, { userId: fd, unlimited: true });
    const rc = await receiptOf(back.id);
    expect(await signReceipt(pool, s(), deps, rc.id)).toMatchObject({ state: "signed" });
    // half of each rate's share of the 100 paid (52.65 at 19 %, 47.35 at 7 %), to the cent, together -50
    const given = fiscal.signed.get(first.id)!.input.amountsPerVatRate;
    const back50 = fiscal.signed.get(rc.id)!.input.amountsPerVatRate;
    expect(back50.map((a) => a.vatRate)).toEqual(given.map((a) => a.vatRate));
    back50.forEach((a, i) => expect(Math.abs(Number(a.amount) + Number(given[i]!.amount) / 2)).toBeLessThanOrEqual(0.01));
    expect(back50.reduce((x, a) => x + Number(a.amount), 0)).toBeCloseTo(-50, 5);
  });

  it("a signer that died midway is taken over; a live claim is left alone", async () => {
    const rc = await receiptOf((await takePayment(pool, s(), payments, { reservationId: res, tender: "cash", amount: 4 }, fd)).id);
    await pool.query(`update ${s()}.fiscal_transactions set state = 'signing', claim = gen_random_uuid(), claimed_at = now() where receipt_id = $1`, [rc.id]);
    expect(await signReceipt(pool, s(), deps, rc.id)).toEqual({ state: "signing" });
    expect(await receiptsToSign(pool, s())).not.toContain(rc.id);
    await pool.query(`update ${s()}.fiscal_transactions set claimed_at = now() - interval '5 minutes' where receipt_id = $1`, [rc.id]);
    expect(await receiptsToSign(pool, s())).toContain(rc.id);
    expect(await signReceipt(pool, s(), deps, rc.id)).toMatchObject({ state: "signed" });
  });

  it("an outage: the payment goes through, the Receipt carries the notice, the outage is logged from start to end", async () => {
    fiscal.down = true;
    const paid = await takePayment(pool, s(), payments, { reservationId: res, tender: "cash", amount: 10 }, fd);
    const rc = await receiptOf(paid.id);
    expect(await signReceipt(pool, s(), deps, rc.id)).toMatchObject({ state: "failed", outageStarted: true });
    const view = await receiptByToken(pool, s(), rc.token);
    expect(view?.fiscal).toMatchObject({ state: "failed", notice: FISCAL_OUTAGE_NOTICE });
    // the next one in the outage does not announce it again
    const second = await receiptOf((await takePayment(pool, s(), payments, { reservationId: res, tender: "cash", amount: 5 }, fd)).id);
    expect(await signReceipt(pool, s(), deps, second.id)).toMatchObject({ state: "failed", outageStarted: false });
    expect((await fiscalStatus(pool, s(), berlin)).outages[0]).toMatchObject({ endedAt: null, error: "TSS not available" });
    // back: the failed Receipts stay unsigned, the next is signed and the outage ends
    fiscal.down = false;
    expect(await signReceipt(pool, s(), deps, rc.id)).toMatchObject({ state: "failed" });
    const next = await receiptOf((await takePayment(pool, s(), payments, { reservationId: res, tender: "cash", amount: 1 }, fd)).id);
    expect(await signReceipt(pool, s(), deps, next.id)).toMatchObject({ state: "signed" });
    expect((await fiscalStatus(pool, s(), berlin)).outages[0]!.endedAt).not.toBeNull();
    // nothing left for the worker
    expect(await receiptsToSign(pool, s())).toEqual([]);
  });

  it("the Business Date is closed per register for DSFinV-K with every Receipt, signed or not", async () => {
    // close the day the Receipts belong to, as after the Night Audit
    const day = (await pool.query(`select to_char(business_date, 'YYYY-MM-DD') as d from ${s()}.fiscal_transactions limit 1`)).rows[0].d;
    await pool.query(`update ${s()}.properties set business_date = $2 where id = $1`, [berlin, addDays(day, 1)]);
    expect(await fiscalDaysToClose(pool, s())).toEqual([{ propertyId: berlin, businessDate: day }]);
    const r = await closeFiscalDay(pool, s(), deps, berlin, day);
    expect(r.failed).toEqual([]);
    expect(r.completed).toBeGreaterThanOrEqual(1);
    const payload = [...fiscal.closings.values()][0] as { cash_point_closing_export_id: number; transactions: { security: Record<string, string> }[]; cash_statement: { payment: { cash_amount: number } } };
    expect(payload.cash_point_closing_export_id).toBe(1);
    expect(payload.transactions.filter((t) => t.security.error_message).length).toBe(2);
    expect(payload.transactions.filter((t) => t.security.tss_tx_id).length).toBeGreaterThanOrEqual(1);
    expect(await fiscalDaysToClose(pool, s())).toEqual([]);
  });

  it("the signed data is archived outside the provider; the registration data for the tax office", async () => {
    const store = new LocalFileStore(await mkdtemp(join(tmpdir(), "fiscal-")));
    const a = await fiscalArchive(pool, s(), { ...deps, store, tenantId: tenant.id }, { propertyId: berlin, kind: "tss", from: `${today.slice(0, 7)}-01`, to: today }, "user_pm");
    expect(a).toMatchObject({ state: "completed", kind: "tss" });
    expect(new TextDecoder().decode((await fiscalArchiveFile(pool, s(), store, a.id))!.bytes)).toMatch(/^FAKE TSS EXPORT/);
    const reg = await fiscalRegistration(pool, s(), berlin);
    expect(reg.taxpayer).toMatchObject({ name: "Alpha GmbH", taxNumber: "27/123/45678" });
    expect(reg.tse?.serial).toMatch(/^[0-9a-f]{64}$/);
    expect(reg.systems.map((x) => x.name)).toContain("Front desk 1");
  });

  it("the narrower scope (after gate 3) still signs cash", async () => {
    await setFiscalScope(pool, s(), berlin, "cash_and_vouchers");
    expect((await fiscalStatus(pool, s(), berlin)).unit?.scope).toBe("cash_and_vouchers");
    const rc = await receiptOf((await takePayment(pool, s(), payments, { reservationId: res, tender: "cash", amount: 3 }, fd)).id);
    expect(await signReceipt(pool, s(), deps, rc.id)).toMatchObject({ state: "signed" });
  });
});
