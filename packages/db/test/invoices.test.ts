import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { FakePaymentProvider } from "@hoteloftware/payments";
import { addDays, todayIn } from "@hoteloftware/domain";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms, type Room } from "../src/tenant/rooms";
import { applyTaxPreset, listTaxCodes } from "../src/tenant/tax-codes";
import { createService } from "../src/tenant/services";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan, type RatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createCompany } from "../src/tenant/companies";
import { createBooking } from "../src/tenant/reservations";
import { assignRoom } from "../src/tenant/reservation-changes";
import { checkIn, loadFolios, postServiceCharge, voidCharge } from "../src/tenant/folios";
import { takePayment } from "../src/tenant/payments";
import { CheckOutBlocked, checkOut, invoiceDocument, issueInvoice, listInvoices, setInvoiceNumberRange } from "../src/tenant/invoices";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: gap-free numbering per Legal Entity under load; the automatic
 * Deposit Invoice for money before check-in and its netting on the final
 * invoice; check-out only with settled guest folios (or an on-account
 * Company); invoiced Charges are closed.
 */
describe("invoices and check-out", () => {
  let pool: Pool;
  let tenant: Tenant;
  let le: string;
  let berlin: string;
  let dbl: string;
  let rooms: Room[];
  let plan: RatePlan;
  let guest: string;
  let minibar: string;
  const provider = new FakePaymentProvider();
  const fd = "user_frida";
  const today = todayIn("Europe/Berlin");
  const day = (n: number) => addDays(today, n);
  const s = () => tenant.schemaName;
  const book = async (arrival: string, departure: string, booker: { guestId: string } | { companyId: string } = { guestId: guest }) =>
    (await createBooking(pool, s(), berlin, fd, { booker, walkIn: false, notes: "", reservations: [{ arrival, departure, roomTypeId: dbl, ratePlanId: plan.id, adults: 2, childAges: [], primaryGuestId: guest }] })).reservations[0]!.id;

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    le = (await createLegalEntity(pool, s(), { name: "Alpha GmbH", country: "DE", addressLine1: "Unter den Linden 1", postalCode: "10117", city: "Berlin", vatId: "DE123456789", taxNumber: "27/123/45678" })).id;
    berlin = (await createProperty(pool, s(), { name: "Berlin", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    dbl = (await createRoomType(pool, s(), { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    rooms = await createRooms(pool, s(), { propertyId: berlin, roomTypeId: dbl, numbers: Array.from({ length: 30 }, (_, i) => String(101 + i)) });
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const id = (c: string) => codes.find((x) => x.code === c)!.id;
    const room = await createService(pool, s(), { propertyId: berlin, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: id("ACC"), revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const brk = await createService(pool, s(), { propertyId: berlin, code: "BRK", name: "Frühstück", defaultPrice: 12, taxCodeId: id("FOOD"), revenueAccount: "8400", postingRhythm: "per_person_night", bookableOnline: false });
    minibar = (await createService(pool, s(), { propertyId: berlin, code: "MINI", name: "Minibar", defaultPrice: 9.5, taxCodeId: id("STD"), revenueAccount: "8410", postingRhythm: "once", bookableOnline: false })).id;
    const pay = await createPaymentPolicy(pool, s(), { propertyId: berlin, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId: berlin, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    plan = await createRatePlan(pool, s(), {
      propertyId: berlin,
      code: "BB",
      name: "Bed and breakfast",
      kind: "base",
      roomTypeIds: [dbl],
      mealPlan: "breakfast",
      accommodationServiceId: room.id,
      includedServices: [{ serviceId: brk.id, componentPrice: 12 }],
      paymentPolicyId: pay.id,
      cancellationPolicyId: cxl.id,
    });
    await setRates(pool, s(), berlin, fd, [0, 1, 2, 3, 4, 5, 6].map((n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: day(n), price: 120 })));
    guest = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka", addressLine1: "1-2-3 Shibuya", postalCode: "150-0002", city: "Tokyo", countryOfResidence: "JP" }, { userId: fd, propertyId: berlin })).id;
    await setInvoiceNumberRange(pool, s(), le, "final", "RE-{YYYY}-{NNNNN}");
    await setInvoiceNumberRange(pool, s(), le, "deposit", "AZ-{YYYY}-{NNNN}");
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("money received before check-in issues a Deposit Invoice with the stay's VAT", async () => {
    const res = await book(day(2), day(4));
    await takePayment(pool, s(), provider, { reservationId: res, tender: "bank_transfer", amount: 100, reference: "deposit" }, fd);
    const [dep] = await listInvoices(pool, s(), res);
    expect(dep).toMatchObject({ kind: "deposit", number: `AZ-${today.slice(0, 4)}-0001`, gross: 100, due: 0 });
    // two nights of 96 room (ACC 7 %) and 24 breakfast (FOOD 7 %): the deposit splits 80 / 20
    const doc = await invoiceDocument(pool, s(), dep!.id);
    expect(doc.totals.byTax.map((t) => [t.taxCode, t.gross, t.vat])).toEqual([
      ["ACC", 80, 5.23],
      ["FOOD", 20, 1.31],
    ]);
  });

  it("the final invoice nets the deposit with its VAT; check-out needs the guest folio settled", async () => {
    const res = await book(today, day(2));
    await takePayment(pool, s(), provider, { reservationId: res, tender: "bank_transfer", amount: 100, reference: "deposit" }, fd);
    await assignRoom(pool, s(), res, fd, rooms[0]!.id);
    await checkIn(pool, s(), res, fd);
    await postServiceCharge(pool, s(), res, { serviceId: minibar, quantity: 1 }, fd);
    // 240 stay + 9.50 minibar, 100 received as deposit: 149.50 open
    await expect(checkOut(pool, s(), res, fd, { override: false })).rejects.toBeInstanceOf(CheckOutBlocked);
    expect((await listInvoices(pool, s(), res)).filter((i) => i.kind === "final")).toEqual([]);
    await takePayment(pool, s(), provider, { reservationId: res, tender: "bank_transfer", amount: 149.5, reference: "rest" }, fd);
    await checkOut(pool, s(), res, fd, { override: false });
    const final = (await listInvoices(pool, s(), res)).find((i) => i.kind === "final")!;
    expect(final).toMatchObject({ gross: 249.5, due: 0 });
    const doc = await invoiceDocument(pool, s(), final.id);
    expect(doc.deposits.map((d) => d.number)).toEqual([expect.stringMatching(/^AZ-/)]);
    expect(doc.totals).toMatchObject({ depositsGross: 100, depositsVat: 6.54, paid: 149.5, due: 0 });
    // invoiced Charges are closed
    const charge = (await loadFolios(pool, s(), res)).folios[0]!.charges[0]!;
    await expect(voidCharge(pool, s(), res, charge.id, "late", fd)).rejects.toThrow(/invoiced/);
  });

  it("an on-account Company's folio becomes a Receivable at check-out", async () => {
    const acme = (await createCompany(pool, s(), { name: "Acme AG", routing: ["accommodation"], onAccount: true, paymentTermsDays: 30, vatId: "DE999999999" }, { userId: fd })).id;
    const res = await book(today, day(1), { companyId: acme });
    await assignRoom(pool, s(), res, fd, rooms[1]!.id);
    await checkIn(pool, s(), res, fd);
    // the guest pays their breakfast; the room goes to Acme on account
    await takePayment(pool, s(), provider, { reservationId: res, tender: "bank_transfer", amount: 24, reference: "breakfast" }, fd);
    await checkOut(pool, s(), res, fd, { override: false });
    const company = (await listInvoices(pool, s(), res)).find((i) => i.billToName === "Acme AG")!;
    expect(company).toMatchObject({ receivable: true, due: 96 });
    expect((await invoiceDocument(pool, s(), company.id)).dueDate).toBe(addDays(today, 30));
  });

  it("on account is no money received: the invoice stays due as a Receivable, yet the folio is settled for check-out", async () => {
    const res = await book(today, day(1));
    await assignRoom(pool, s(), res, fd, rooms[2]!.id);
    await checkIn(pool, s(), res, fd);
    await takePayment(pool, s(), provider, { reservationId: res, tender: "on_account", amount: 120 }, fd);
    await checkOut(pool, s(), res, fd, { override: false });
    expect((await listInvoices(pool, s(), res)).find((i) => i.kind === "final")).toMatchObject({ due: 120, receivable: true });
  });

  it("the yearly counter only moves forward, and a first number set this year is kept", async () => {
    const other = (await createLegalEntity(pool, s(), { name: "Beta GmbH", country: "DE", addressLine1: "X 1", postalCode: "10115", city: "Berlin", vatId: "DE999999998" })).id;
    await setInvoiceNumberRange(pool, s(), other, "final", "B-{YYYY}-{NNNN}", 120);
    const year = Number(today.slice(0, 4));
    // a property still in the old year issues after the new year has started elsewhere: no restart, no duplicate
    await pool.query(`update ${s()}.invoice_number_ranges set counter_year = $2 where legal_entity_id = $1`, [other, year + 1]);
    const { rows } = await pool.query(`select next_value, counter_year from ${s()}.invoice_number_ranges where legal_entity_id = $1`, [other]);
    expect(rows[0]).toMatchObject({ next_value: 120 });
  });

  it("parallel invoices get consecutive numbers without gap or duplicate; a refused check-out leaves no gap", async () => {
    const reservations = await Promise.all(Array.from({ length: 8 }, () => book(today, day(1))));
    // each gets a Charge on its folio to invoice
    for (const r of reservations) await postServiceCharge(pool, s(), r, { serviceId: minibar, quantity: 1 }, fd);
    const before = (await pool.query(`select next_value from ${s()}.invoice_number_ranges where legal_entity_id = $1 and kind = 'final'`, [le])).rows[0].next_value as number;
    // a check-out that fails rolls its number back
    const open = await book(today, day(1));
    await assignRoom(pool, s(), open, fd, rooms[9]!.id);
    await checkIn(pool, s(), open, fd);
    await expect(checkOut(pool, s(), open, fd, { override: false })).rejects.toBeInstanceOf(CheckOutBlocked);
    const issued = await Promise.all(reservations.map(async (r) => issueInvoice(pool, s(), (await loadFolios(pool, s(), r)).folios[0]!.id, fd)));
    const counters = issued.map((i) => Number(i.number.split("-").pop())).sort((a, b) => a - b);
    expect(counters).toEqual(Array.from({ length: 8 }, (_, i) => before + i));
  });
});
