import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { FakePaymentProvider } from "@hoteloftware/payments";
import { PRICE_HORIZON_DAYS, addDays, todayIn } from "@hoteloftware/domain";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { deleteExpiredDemoTenants, findTenantBySlug, provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms, type Room } from "../src/tenant/rooms";
import { applyTaxPreset, listTaxCodes } from "../src/tenant/tax-codes";
import { createService } from "../src/tenant/services";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan, type RatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createBooking } from "../src/tenant/reservations";
import { assignRoom } from "../src/tenant/reservation-changes";
import { checkIn, loadFolios } from "../src/tenant/folios";
import { onboardPaymentAccount, placeCardHold, refreshPaymentAccount, takePayment } from "../src/tenant/payments";
import { checkOut, invoiceDocument, listInvoices, setInvoiceNumberRange } from "../src/tenant/invoices";
import { createCityTaxRule } from "../src/tenant/city-tax";
import { closeNightAudit } from "../src/tenant/night-audit";
import { GoLiveBlocked, goLive, goLiveCheckCurrent, goLiveChecklistOf, markGoLiveChecked, tenantLifecycle, testRecordCounts } from "../src/tenant/go-live";
import { seedDemoData } from "../src/tenant/demo";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: a trial tenant provisioned with demo data; Test Mode records (test
 * invoice numbers, no card charged); go-live refused while the checklist is
 * incomplete or unchecked, then clearing test records and keeping setup and
 * imported records; demo tenants deleted 30 days after the trial.
 */
describe("trial, Test Mode and go-live", () => {
  let pool: Pool;
  let tenant: Tenant;
  let le: string;
  let berlin: string;
  let dbl: string;
  let rooms: Room[];
  let plan: RatePlan;
  let guest: string;
  const provider = new FakePaymentProvider();
  const owner = "user_owner";
  const today = todayIn("Europe/Berlin");
  const s = () => tenant.schemaName;
  const q = async <T,>(sql: string, args: unknown[] = []) => (await pool.query(sql.replaceAll("$s", `"${s()}"`), args)).rows as T[];
  const stay = async (guestId: string, nights = 1) => {
    const res = (await createBooking(pool, s(), berlin, owner, { booker: { guestId }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: addDays(today, nights), roomTypeId: dbl, ratePlanId: plan.id, adults: 2, childAges: [], primaryGuestId: guestId }] })).reservations[0]!.id;
    return res;
  };

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha", trial: "own" }, tenantMigrations());
    await pool.query(`insert into control."user" (id, tenant_id, name, email) values ($1, $2, 'Olga Owner', 'olga@alpha.example'), ('user_staff', $2, 'Sven Staff', 'sven@alpha.example'), ('user_support', $2, 'Sam Support', 'sam@platform.example')`, [owner, tenant.id]);
    le = (await createLegalEntity(pool, s(), { name: "Alpha GmbH", country: "DE", addressLine1: "Unter den Linden 1", postalCode: "10117", city: "Berlin", vatId: "DE123456789", taxNumber: "27/123/45678" })).id;
    berlin = (await createProperty(pool, s(), { name: "Berlin", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    dbl = (await createRoomType(pool, s(), { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    rooms = await createRooms(pool, s(), { propertyId: berlin, roomTypeId: dbl, numbers: ["101", "102", "103"] });
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const id = (c: string) => codes.find((x) => x.code === c)!.id;
    const room = await createService(pool, s(), { propertyId: berlin, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: id("ACC"), revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const pay = await createPaymentPolicy(pool, s(), { propertyId: berlin, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId: berlin, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    plan = await createRatePlan(pool, s(), { propertyId: berlin, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), berlin, owner, Array.from({ length: 30 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price: 100 })));
    await createCityTaxRule(pool, s(), berlin, { preset: "berlin", taxCodeId: id("ZERO") }, owner);
    guest = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka", addressLine1: "1-2-3 Shibuya", postalCode: "150-0002", city: "Tokyo", countryOfResidence: "JP" }, { userId: owner, propertyId: berlin })).id;
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("a demo trial tenant is provisioned with a week of history in under a minute", async () => {
    const started = Date.now();
    const demo = await provisionTenant(pool, { slug: "demo1", name: "Demo One", trial: "demo" }, tenantMigrations());
    const { propertyId } = await seedDemoData(pool, demo.schemaName, "user_demo");
    expect(Date.now() - started).toBeLessThan(60_000);
    const life = await tenantLifecycle(pool, demo.id);
    expect(life).toMatchObject({ trialKind: "demo", liveAt: null });
    expect(Math.round((life.trialEndsAt!.getTime() - Date.now()) / 86_400_000)).toBe(30);
    const [p] = await pool.query(`select to_char(business_date, 'YYYY-MM-DD') as bd, (select count(*)::int from "${demo.schemaName}".rooms) as rooms, (select count(*)::int from "${demo.schemaName}".night_audits where status = 'closed') as audits, (select count(*)::int from "${demo.schemaName}".invoices where test) as invoices, (select count(*)::int from "${demo.schemaName}".reservations where test) as reservations from "${demo.schemaName}".properties where id = $1`, [propertyId]).then((r) => r.rows);
    expect(p).toMatchObject({ bd: today, rooms: 28, audits: 7 });
    expect(p.invoices).toBeGreaterThan(5);
    expect(p.reservations).toBeGreaterThan(50);
    // demo invoices are test invoices
    const inv = await pool.query(`select number from "${demo.schemaName}".invoices limit 1`);
    expect(inv.rows[0].number).toMatch(/^TEST-/);
    // the demo never goes live
    await expect(goLive(pool, demo)).rejects.toThrow(/demo tenant does not go live/);
  }, 120_000);

  it("a Test Mode invoice carries a test mark and no real number; the real range is untouched", async () => {
    await setInvoiceNumberRange(pool, s(), le, "final", "RE-{YYYY}-{NNNNN}", 500);
    const res = await stay(guest);
    await assignRoom(pool, s(), res, owner, rooms[0]!.id);
    await checkIn(pool, s(), res, owner);
    const balance = (await loadFolios(pool, s(), res)).folios[0]!.balance;
    await takePayment(pool, s(), provider, { reservationId: res, tender: "bank_transfer", amount: balance, reference: "test" }, owner);
    await checkOut(pool, s(), res, owner, { override: false });
    const [inv] = await listInvoices(pool, s(), res);
    expect(inv!.number).toBe("TEST-00001");
    const doc = await invoiceDocument(pool, s(), inv!.id);
    expect(doc.test).toBe(true);
    expect(doc.notes[0]).toMatch(/TEST/);
    expect((await q<{ next_value: number }>("select next_value from $s.invoice_number_ranges where kind = 'final'"))[0]!.next_value).toBe(500);
  });

  it("no card is charged in Test Mode with a live provider", async () => {
    const live = Object.assign(new FakePaymentProvider(), { testMode: false });
    await onboardPaymentAccount(pool, s(), live, { tenantId: tenant.id, legalEntityId: le, email: "o@alpha.example", returnUrl: "http://x", refreshUrl: "http://x" }, owner);
    await refreshPaymentAccount(pool, s(), live, le);
    const res = await stay(guest, 2);
    await expect(placeCardHold(pool, s(), live, { reservationId: res, amount: 50, readerId: "none" }, owner)).rejects.toThrow(/No card is charged in Test Mode/);
  });

  it("go-live is blocked while a required item is missing, and until our staff checked the list", async () => {
    // prices only 30 days ahead
    const blocked = (await goLiveChecklistOf(pool, s(), tenant.id)).filter((i) => !i.done && i.level === "required").map((i) => i.id);
    expect(blocked).toEqual(["rates_500_days"]);
    await expect(goLive(pool, tenant)).rejects.toBeInstanceOf(GoLiveBlocked);
    await setRates(pool, s(), berlin, owner, Array.from({ length: PRICE_HORIZON_DAYS + 10 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price: 100 })));
    await expect(goLive(pool, tenant)).rejects.toThrow(/support staff check/);
  });

  it("go-live clears test records, keeps setup and imported records, and starts real numbering and the Business Date", async () => {
    // an imported guest and future reservation (the import sets the test mark off)
    const imported = (await createGuest(pool, s(), { firstName: "Ida", lastName: "Import", addressLine1: "Weg 1", postalCode: "10115", city: "Berlin", countryOfResidence: "DE" }, { userId: owner, propertyId: berlin })).id;
    const importedRes = (await createBooking(pool, s(), berlin, owner, { booker: { guestId: imported }, walkIn: false, notes: "", reservations: [{ arrival: addDays(today, 10), departure: addDays(today, 12), roomTypeId: dbl, ratePlanId: plan.id, adults: 2, childAges: [], primaryGuestId: imported }] })).reservations[0]!.id;
    await q("update $s.guests set test = false where id = $1", [imported]);
    await q("update $s.bookings set test = false where id = (select booking_id from $s.reservations where id = $1)", [importedRes]);
    await q("update $s.reservations set test = false where id = $1", [importedRes]);
    // a test day closed
    await q("update $s.properties set business_date = $2 where id = $1", [berlin, addDays(today, -1)]);
    await closeNightAudit(pool, s(), berlin, owner).catch(() => undefined);
    await q("update $s.properties set business_date = $2 where id = $1", [berlin, addDays(today, 3)]);
    const preview = await testRecordCounts(pool, s());
    expect(preview).toMatchObject({ invoices: 1, guests: 1, payments: 1 });
    expect(preview.reservations).toBe(2);
    await markGoLiveChecked(pool, tenant, "user_support");
    expect((await tenantLifecycle(pool, tenant.id)).checkedBy).toBe("Sam Support");
    // a change after the check needs a new check
    await createRooms(pool, s(), { propertyId: berlin, roomTypeId: dbl, numbers: ["104"] });
    expect(await goLiveCheckCurrent(pool, tenant)).toBe(false);
    await expect(goLive(pool, tenant)).rejects.toThrow(/setup changed/);
    await markGoLiveChecked(pool, tenant, "user_support");
    expect(await goLiveCheckCurrent(pool, tenant)).toBe(true);
    const cleared = await goLive(pool, tenant);
    expect(cleared.invoices).toBe(1);
    // test records gone; setup and imported records kept
    const left = (await q<Record<string, number>>(
      `select (select count(*)::int from $s.reservations) as reservations, (select count(*)::int from $s.guests) as guests, (select count(*)::int from $s.invoices) as invoices,
        (select count(*)::int from $s.payments) as payments, (select count(*)::int from $s.night_audits) as audits, (select count(*)::int from $s.charges) as charges,
        (select count(*)::int from $s.rooms) as rooms, (select count(*)::int from $s.rates) as rates, (select count(*)::int from $s.city_tax_rules) as rules`,
    ))[0]!;
    expect(left).toMatchObject({ reservations: 1, guests: 1, invoices: 0, payments: 0, audits: 0, charges: 0, rooms: 4, rules: 1 });
    expect(left.rates).toBeGreaterThan(500);
    expect((await q<{ id: string }>("select id from $s.reservations"))[0]!.id).toBe(importedRes);
    // live: the Business Date starts today, the next invoice gets the real number the range was set up with
    expect((await q<{ bd: string }>("select to_char(business_date, 'YYYY-MM-DD') as bd from $s.properties"))[0]!.bd).toBe(today);
    expect((await tenantLifecycle(pool, tenant.id)).liveAt).not.toBeNull();
    const g = (await createGuest(pool, s(), { firstName: "Real", lastName: "Guest", addressLine1: "Str. 1", postalCode: "10115", city: "Berlin", countryOfResidence: "DE" }, { userId: owner, propertyId: berlin })).id;
    expect((await q<{ test: boolean }>("select test from $s.guests where id = $1", [g]))[0]!.test).toBe(false);
    const res = await stay(g);
    await assignRoom(pool, s(), res, owner, rooms[1]!.id);
    await checkIn(pool, s(), res, owner);
    await takePayment(pool, s(), provider, { reservationId: res, tender: "bank_transfer", amount: (await loadFolios(pool, s(), res)).folios[0]!.balance, reference: "real" }, owner);
    await checkOut(pool, s(), res, owner, { override: false });
    expect((await listInvoices(pool, s(), res))[0]!.number).toBe(`RE-${today.slice(0, 4)}-00500`);
    // once live, nothing clears records any more
    await expect(goLive(pool, tenant)).rejects.toThrow(/already live/);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local search_path to "${s()}"`);
      await client.query("select set_config('hoteloftware.clearing_test_records', 'on', true)");
      await expect(client.query("delete from invoices")).rejects.toThrow(/cannot be deleted/);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("a demo tenant is deleted 30 days after its trial ends; an own-data trial is kept", async () => {
    const demo = await provisionTenant(pool, { slug: "demo2", name: "Demo Two", trial: "demo" }, tenantMigrations());
    const own = await provisionTenant(pool, { slug: "own2", name: "Own Two", trial: "own" }, tenantMigrations());
    await pool.query("update control.tenants set trial_ends_at = now() - interval '31 days' where id = any($1)", [[demo.id, own.id]]);
    const deleted = await deleteExpiredDemoTenants(pool);
    expect(deleted).toContain("demo2");
    expect(await findTenantBySlug(pool, "demo2")).toBeNull();
    expect(await findTenantBySlug(pool, "own2")).not.toBeNull();
    expect((await pool.query("select 1 from pg_namespace where nspname = $1", [demo.schemaName])).rowCount).toBe(0);
  });
});
