import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { FakeFiscalProvider } from "@hoteloftware/fiscal";
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
import { checkIn, postServiceCharge } from "../src/tenant/folios";
import { refundPayment, takePayment } from "../src/tenant/payments";
import { cashBook, createCashRegister, openShift, receiptByToken, setCashDesk } from "../src/tenant/cash";
import { registerFiscalClients, setUpFiscal, signReceipt } from "../src/tenant/fiscal";
import { listVouchers, sellVoucher, setVoucherLiabilityAccount, voucherByCode } from "../src/tenant/vouchers";
import { runReport } from "../src/tenant/reports";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: the desk sells a Voucher (cash into the Cash Book on the liability
 * account, a signed Receipt, the code by email with a copy to the buyer); it
 * is redeemed as a Tender, partly and again, only at the selling Legal
 * Entity's properties; the redemption is signed like cash; Vouchers in
 * circulation are listed with their balance.
 */
describe("Vouchers at the desk", () => {
  let pool: Pool;
  let tenant: Tenant;
  let berlin = "";
  let potsdam = "";
  let wien = "";
  let le = "";
  const stays: Record<string, string> = {};
  const fd = "user_frida";
  const today = todayIn("Europe/Berlin");
  const fiscal = new FakeFiscalProvider();
  const deps = { provider: fiscal, secret: "a-test-fiscal-secret" };
  const payments = new FakePaymentProvider();
  const s = () => tenant.schemaName;
  const viewer = () => ({ userId: fd, actor: { propertyRoles: [berlin, potsdam, wien].map((propertyId) => ({ propertyId, role: "front_desk" as const })) } });
  const sale = { amount: 100, tender: "cash" as const, reference: "", buyerName: "Max Muster", buyerEmail: "max@example.com", recipientName: "Erika Muster", recipientEmail: "erika@example.com", message: "Alles Gute!" };

  const property = async (name: string, legalEntityId: string, country: string, tz: string, preset: string) => {
    const id = (await createProperty(pool, s(), { name, legalEntityId, country, timeZone: tz, currency: "EUR" })).id;
    const dbl = (await createRoomType(pool, s(), { propertyId: id, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    await createRooms(pool, s(), { propertyId: id, roomTypeId: dbl, numbers: ["101"] });
    if (!(await listTaxCodes(pool, s(), legalEntityId)).length) await applyTaxPreset(pool, s(), legalEntityId, preset);
    const codes = await listTaxCodes(pool, s(), legalEntityId);
    const room = await createService(pool, s(), { propertyId: id, code: "ROOM", name: "Room", defaultPrice: 0, taxCodeId: codes.find((c) => c.code === "ACC")!.id, revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const mini = await createService(pool, s(), { propertyId: id, code: "MINI", name: "Minibar", defaultPrice: 100, taxCodeId: codes.find((c) => c.code === "STD")!.id, revenueAccount: "8400", postingRhythm: "once", bookableOnline: false });
    const pay = await createPaymentPolicy(pool, s(), { propertyId: id, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId: id, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s(), { propertyId: id, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    const day = todayIn(tz);
    await setRates(pool, s(), id, fd, [{ ratePlanId: plan.id, roomTypeId: dbl, date: day, price: 100 }]);
    const g = (await createGuest(pool, s(), { firstName: "Anna", lastName: "Gast" }, { userId: fd, propertyId: id })).id;
    const res = (await createBooking(pool, s(), id, fd, { booker: { guestId: g }, walkIn: false, notes: "", reservations: [{ arrival: day, departure: addDays(day, 1), roomTypeId: dbl, ratePlanId: plan.id, adults: 1, childAges: [], primaryGuestId: g }] })).reservations[0]!.id;
    await pool.query(`update ${s()}.rooms set cleanliness = 'inspected' where property_id = $1`, [id]);
    await pool.query(`insert into ${s()}.room_assignments (reservation_id, room_id, from_date, to_date) select $1, id, $2, $3 from ${s()}.rooms where property_id = $4`, [res, day, addDays(day, 1), id]);
    await checkIn(pool, s(), res, fd);
    await postServiceCharge(pool, s(), res, { serviceId: mini.id, quantity: 1 }, fd);
    stays[id] = res;
    return id;
  };

  beforeAll(async () => {
    pool = testPool(6);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    le = (await createLegalEntity(pool, s(), { name: "Alpha GmbH", country: "DE", addressLine1: "Ring 1", postalCode: "10115", city: "Berlin", vatId: "DE123456789", taxNumber: "1" })).id;
    const other = (await createLegalEntity(pool, s(), { name: "Donau GmbH", country: "AT", addressLine1: "Ring 1", postalCode: "1010", city: "Wien", vatId: "ATU12345678", taxNumber: "1" })).id;
    berlin = await property("Berlin", le, "DE", "Europe/Berlin", "DE");
    potsdam = await property("Potsdam", le, "DE", "Europe/Berlin", "DE");
    wien = await property("Wien", other, "AT", "Europe/Vienna", "AT");
    await setCashDesk(pool, s(), berlin, { enabled: true, tolerance: 5, paidOutLimit: 100, differenceAccount: "1370" });
    await setUpFiscal(pool, s(), deps, berlin, "user_pm");
    const reg = await createCashRegister(pool, s(), berlin, "Rezeption");
    await registerFiscalClients(pool, s(), deps, berlin);
    await openShift(pool, s(), { registerId: reg, count: {} }, viewer());
  });
  afterAll(() => pool.end());

  let code = "";

  it("a Voucher sold for cash: into the Cash Book on the liability account, a signed Receipt, the code by email with a copy to the buyer", async () => {
    await expect(sellVoucher(pool, s(), { ...sale, propertyId: berlin }, viewer())).rejects.toThrow(/liability account/);
    await setVoucherLiabilityAccount(pool, s(), le, "1720");
    const sold = await sellVoucher(pool, s(), { ...sale, propertyId: berlin }, viewer());
    code = sold.code;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const reg = (await pool.query(`select id from ${s()}.cash_registers where property_id = $1`, [berlin])).rows[0].id;
    const book = await cashBook(pool, s(), reg, { userId: "user_pm", actor: { propertyRoles: [{ propertyId: berlin, role: "property_manager" as const }] } });
    expect(book.rows.find((r) => r.kind === "voucher_sale")).toMatchObject({ amount: 100, account: "1720" });
    // the cash report shows it on the liability account, not as revenue
    const day = (await pool.query(`select to_char(business_date, 'YYYY-MM-DD') as d from ${s()}.cash_movements where kind = 'voucher_sale'`)).rows[0].d;
    const report = await runReport(pool, s(), { kind: "cash", from: day, to: day, propertyIds: [berlin], grain: "day", compare: { previous: false, lastYear: false }, language: "en" });
    expect(report.rows.find((r) => String(r.cells.label).includes("1720"))?.cells.vouchers).toBe(100);
    expect(report.rows.find((r) => String(r.cells.label).includes("outstanding"))?.cells.vouchers).toBe(100);
    const rc = (await pool.query(`select id from ${s()}.receipts where token = $1`, [sold.receiptToken])).rows[0].id;
    expect(await signReceipt(pool, s(), deps, rc)).toMatchObject({ state: "signed" });
    expect(fiscal.signed.get(rc)!.input.amountsPerVatRate).toEqual([{ vatRate: "NULL", amount: "100.00" }]);
    expect((await receiptByToken(pool, s(), sold.receiptToken))).toMatchObject({ amount: 100, voucherSale: { codeEnd: code.slice(-4) }, confirmationNumber: null });
    const mails = (await pool.query(`select to_email, body from ${s()}.mail_outbox where voucher_id = $1 order by to_email`, [sold.id])).rows;
    expect(mails.map((m) => m.to_email)).toEqual(["erika@example.com", "max@example.com"]);
    expect(mails[0].body).toContain(code);
  });

  it("partial redemption leaves the right balance and a second redemption uses it; the redemption is signed like cash", async () => {
    const first = await takePayment(pool, s(), payments, { reservationId: stays[berlin]!, tender: "voucher", amount: 30, voucherCode: code.toLowerCase() }, fd);
    expect((await voucherByCode(pool, s(), berlin, code))).toMatchObject({ balance: 70, redeemableHere: true });
    const rc = (await pool.query(`select id from ${s()}.receipts where payment_id = $1`, [first.id])).rows[0].id;
    expect(await signReceipt(pool, s(), deps, rc)).toMatchObject({ state: "signed" });
    expect(fiscal.signed.get(rc)!.input.amountsPerPaymentType).toEqual([{ paymentType: "NON_CASH", amount: "30.00", currency: "EUR" }]);
    // at another property of the same company
    await expect(takePayment(pool, s(), payments, { reservationId: stays[potsdam]!, tender: "voucher", amount: 80, voucherCode: code }, fd)).rejects.toThrow(/Only 70.00 is left/);
    await takePayment(pool, s(), payments, { reservationId: stays[potsdam]!, tender: "voucher", amount: 70, voucherCode: code }, fd);
    expect((await voucherByCode(pool, s(), potsdam, code))?.balance).toBe(0);
    await expect(takePayment(pool, s(), payments, { reservationId: stays[berlin]!, tender: "voucher", amount: 1, voucherCode: code }, fd)).rejects.toThrow(/Nothing is left/);
    // a redemption given back goes back onto the Voucher
    await refundPayment(pool, s(), payments, { paymentId: first.id, amount: 10, reason: "Corrected" }, { userId: fd, unlimited: true });
    expect((await voucherByCode(pool, s(), berlin, code))?.balance).toBe(10);
  });

  it("redemption at a property of another Legal Entity is refused", async () => {
    await expect(takePayment(pool, s(), payments, { reservationId: stays[wien]!, tender: "voucher", amount: 5, voucherCode: code }, fd)).rejects.toThrow(/another company/);
    expect((await voucherByCode(pool, s(), wien, code))?.redeemableHere).toBe(false);
    await expect(takePayment(pool, s(), payments, { reservationId: stays[berlin]!, tender: "voucher", amount: 5, voucherCode: "AAAA-BBBB" }, fd)).rejects.toThrow(/code/);
  });

  it("Vouchers in circulation are listed with their balance; a sold Voucher never changes", async () => {
    await sellVoucher(pool, s(), { ...sale, propertyId: potsdam, tender: "bank_transfer", reference: "SEPA 4711", amount: 50 }, viewer());
    // a card sale counts on the liability account too, though not in the Cash Book
    const day = (await pool.query(`select to_char(business_date, 'YYYY-MM-DD') as d from ${s()}.cash_movements where kind = 'voucher_sale'`)).rows[0].d;
    const report = await runReport(pool, s(), { kind: "cash", from: day, to: addDays(day, 1), propertyIds: [potsdam], grain: "day", compare: { previous: false, lastYear: false }, language: "en" });
    expect(report.rows.find((r) => String(r.cells.label).includes("1720"))?.cells.vouchers).toBe(50);
    const open = await listVouchers(pool, s(), berlin, { open: true });
    expect(open.map((v) => [v.amount, v.balance]).sort()).toEqual([[100, 10], [50, 50]].sort());
    await expect(sellVoucher(pool, s(), { ...sale, propertyId: potsdam, tender: "card_terminal", reference: "" }, viewer())).rejects.toThrow(/reference/);
    await expect(pool.query(`update ${s()}.vouchers set amount = 1000`)).rejects.toThrow(/never changed/);
  });
});
