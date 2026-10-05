import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn } from "@hoteloftware/domain";
import { FakeMailProvider, FakeSmsProvider } from "@hoteloftware/messaging";
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
import { dispatchMessages, reservationMessages, scanGuestMessages } from "../src/tenant/messages";
import { addPortalExtra, invitePortalGuest, portalKeys, portalView, requestPortalCode, revokePortalLink, savePrecheckin, verifyPortalCode } from "../src/tenant/portal";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: a Portal Link opens its stay (the Booker's opens the booking) until
 * 30 days after departure and not after revocation; Pre-check-in writes to
 * the profile as entered by the guest; extras until arrival; the code
 * fallback; links in messages.
 */
describe("Guest Portal", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let reservationIds: string[] = [];
  let confirmation = "";
  let breakfast = "";
  const fd = "user_frida";
  const today = todayIn("Europe/Berlin");
  const s = () => tenant.schemaName;
  const links = { base: "https://alpha.hoteloftware.test" };
  const mail = new FakeMailProvider();

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "A GmbH", country: "DE", addressLine1: "Ring 1", postalCode: "10115", city: "Berlin", vatId: "DE1", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s(), { name: "Haus am Ring", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    const dbl = (await createRoomType(pool, s(), { propertyId, code: "DBL", name: "Double", maxOccupancy: 3, maxAdults: 2, bedPlaces: 2, extraBeds: 1 })).id;
    await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: ["101", "102"] });
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const room = await createService(pool, s(), { propertyId, code: "ROOM", name: "Room", defaultPrice: 0, taxCodeId: codes.find((c) => c.code === "ACC")!.id, revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    breakfast = (await createService(pool, s(), { propertyId, code: "BF", name: "Breakfast", defaultPrice: 18, taxCodeId: codes.find((c) => c.code === "STD")!.id, revenueAccount: "8400", postingRhythm: "once", bookableOnline: true })).id;
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s(), { propertyId, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), propertyId, fd, Array.from({ length: 10 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price: 100 })));
    const booker = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka", email: "aiko@example.com", language: "en" }, { userId: fd, propertyId })).id;
    const roommate = (await createGuest(pool, s(), { firstName: "Ken", lastName: "Sato" }, { userId: fd, propertyId })).id;
    const b = await createBooking(pool, s(), propertyId, fd, {
      booker: { guestId: booker },
      walkIn: false,
      notes: "",
      reservations: [
        { arrival: addDays(today, 2), departure: addDays(today, 4), roomTypeId: dbl, ratePlanId: plan.id, adults: 2, childAges: [], primaryGuestId: booker },
        { arrival: addDays(today, 2), departure: addDays(today, 4), roomTypeId: dbl, ratePlanId: plan.id, adults: 1, childAges: [], primaryGuestId: roommate },
      ],
    });
    reservationIds = b.reservations.map((r) => r.id);
    confirmation = b.confirmationNumber;
  });
  afterAll(() => pool.end());

  it("the stay's link opens it; the booking's link opens every room; unknown keys open nothing", async () => {
    const keys = (await portalKeys(pool, s(), reservationIds[0]!))!;
    const v = await portalView(pool, s(), keys.reservation);
    expect(v).toMatchObject({ kind: "reservation", stay: { confirmationNumber: confirmation, roomType: "Double", guest: { lastName: "Tanaka" } }, property: { name: "Haus am Ring" } });
    const booking = await portalView(pool, s(), keys.booking);
    expect(booking?.kind === "booking" && booking.stays.map((x) => x.guestName)).toEqual(["Aiko Tanaka", "Ken Sato"]);
    expect(await portalView(pool, s(), "0".repeat(64))).toBeNull();
    expect(await portalView(pool, s(), "not-a-key")).toBeNull();
  });

  it("Pre-check-in goes to the profile as entered by the guest, with companions, arrival time and consent", async () => {
    const keys = (await portalKeys(pool, s(), reservationIds[0]!))!;
    await savePrecheckin(pool, s(), keys.reservation, {
      firstName: "Aiko", lastName: "Tanaka", dateOfBirth: "1990-04-01", nationality: "JP", countryOfResidence: "JP", addressLine1: "1-2-3 Shibuya", postalCode: "150-0002", city: "Tokyo", phone: "+81 3 1234 5678",
      documentType: "passport", documentNumber: "TK1234567", documentCountry: "JP", documentExpiry: "2031-01-01", arrivalTime: "21:30",
      companions: [{ firstName: "Yui", lastName: "Tanaka", dateOfBirth: "1992-02-02", nationality: "JP" }],
      emailConsent: { granted: true, wording: "Messages about my stay by email" },
    });
    const v = await portalView(pool, s(), keys.reservation);
    expect(v?.kind === "reservation" && v.stay).toMatchObject({ arrivalTime: "21:30", companions: [{ lastName: "Tanaka", nationality: "JP" }], emailConsent: true, guest: { documentNumber: "TK1234567", city: "Tokyo" } });
    expect(v?.kind === "reservation" && v.stay.precheckinAt).toBeTruthy();
    const changes = (await pool.query(`select distinct user_id from ${s()}.guest_changes c join ${s()}.reservations r on r.primary_guest_id = c.guest_id where r.id = $1`, [reservationIds[0]])).rows;
    expect(changes).toEqual([{ user_id: "guest-portal" }]);
    const bad = { firstName: "", lastName: "Tanaka", dateOfBirth: null, nationality: null, countryOfResidence: null, addressLine1: "", postalCode: "", city: "", phone: "", documentType: null, documentNumber: "", documentCountry: null, documentExpiry: null, arrivalTime: "25:00", companions: [], emailConsent: null };
    await expect(savePrecheckin(pool, s(), keys.reservation, bad)).rejects.toThrow(/HH:MM/);
    // empty fields keep what is stored
    await savePrecheckin(pool, s(), keys.reservation, { ...bad, arrivalTime: "22:00", emailConsent: { granted: true, wording: "Messages about my stay by email" } });
    const again = await portalView(pool, s(), keys.reservation);
    expect(again?.kind === "reservation" && again.stay.guest).toMatchObject({ documentNumber: "TK1234567", city: "Tokyo", dateOfBirth: "1990-04-01" });
    // consent unchanged: no second record
    expect((await pool.query(`select count(*)::int as n from ${s()}.messaging_consents`)).rows[0].n).toBe(1);
  });

  it("extras from the catalogue until arrival become charges on the stay", async () => {
    const keys = (await portalKeys(pool, s(), reservationIds[0]!))!;
    await addPortalExtra(pool, s(), keys.reservation, breakfast, 2);
    const v = await portalView(pool, s(), keys.reservation);
    expect(v?.kind === "reservation" && v.stay.added).toEqual([{ description: "Breakfast", quantity: 2, amount: 36 }]);
  });

  it("a revoked link opens nothing; links end 30 days after departure", async () => {
    const old = (await portalKeys(pool, s(), reservationIds[1]!))!.reservation;
    const fresh = await revokePortalLink(pool, s(), reservationIds[1]!);
    expect(await portalView(pool, s(), old)).toBeNull();
    expect(await portalView(pool, s(), fresh)).not.toBeNull();
    await pool.query(`update ${s()}.reservations set departure = $2, arrival = $3 where id = $1`, [reservationIds[1], addDays(today, -31), addDays(today, -33)]);
    expect(await portalView(pool, s(), fresh)).toBeNull();
    await pool.query(`update ${s()}.reservations set departure = $2, arrival = $3 where id = $1`, [reservationIds[1], addDays(today, 4), addDays(today, 2)]);
  });

  it("the Booker invites a room's guest by email, with the room's link", async () => {
    const keys = (await portalKeys(pool, s(), reservationIds[1]!))!;
    await invitePortalGuest(pool, s(), keys.booking, reservationIds[1]!, "ken@example.com", links);
    const msgs = await reservationMessages(pool, s(), reservationIds[1]!);
    expect(msgs.find((m) => m.type === "portal_invitation")).toMatchObject({ toEmail: "ken@example.com", status: "queued" });
    await dispatchMessages(pool, s(), tenant.id, { mail, sms: new FakeSmsProvider() }, { platformDomain: "mail.test" });
    expect(mail.sent.find((m) => m.to === "ken@example.com")!.text).toContain(`${links.base}/g/${keys.reservation}`);
  });

  it("the Booker's room: an invitation gives that room's guest a profile of their own, never the Booker's", async () => {
    const keys = (await portalKeys(pool, s(), reservationIds[0]!))!;
    const booker = (await pool.query(`select primary_guest_id from ${s()}.reservations where id = $1`, [reservationIds[0]])).rows[0].primary_guest_id;
    await invitePortalGuest(pool, s(), keys.booking, reservationIds[0]!, "colleague@example.com", links);
    const now = (await pool.query(`select r.primary_guest_id, g.email from ${s()}.reservations r join ${s()}.guests g on g.id = r.primary_guest_id where r.id = $1`, [reservationIds[0]])).rows[0];
    expect(now.primary_guest_id).not.toBe(booker);
    expect(now.email).toBe("colleague@example.com");
    // the booking view carries no room guest's email or room link
    const v = await portalView(pool, s(), keys.booking);
    expect(JSON.stringify(v)).not.toContain("colleague@example.com");
    expect(JSON.stringify(v)).not.toContain(keys.reservation);
    // three a day per room
    await invitePortalGuest(pool, s(), keys.booking, reservationIds[0]!, "colleague@example.com", links);
    await invitePortalGuest(pool, s(), keys.booking, reservationIds[0]!, "colleague@example.com", links);
    await expect(invitePortalGuest(pool, s(), keys.booking, reservationIds[0]!, "x@example.com", links)).rejects.toThrow(/often enough/);
  });

  it("the Booker's link is revoked like a stay's", async () => {
    const old = (await portalKeys(pool, s(), reservationIds[0]!))!.booking;
    await revokePortalLink(pool, s(), reservationIds[0]!, "booking");
    expect(await portalView(pool, s(), old)).toBeNull();
  });

  it("parallel guesses cannot pass the five tries", async () => {
    await pool.query(`delete from ${s()}.portal_codes`);
    // both rooms now have their invited guests' own profiles
    await requestPortalCode(pool, s(), { confirmationNumber: confirmation, lastName: "Guest" }, links);
    const guesses = await Promise.all(Array.from({ length: 30 }, (_, i) => verifyPortalCode(pool, s(), { confirmationNumber: confirmation, lastName: "Guest", code: String(100000 + i) })));
    expect(guesses.every((g) => g === null)).toBe(true);
    expect((await pool.query(`select attempts from ${s()}.portal_codes`)).rows[0].attempts).toBe(5);
  });

  it("without the link: the Booker of several rooms gets a code that opens the whole booking; the code is not kept", async () => {
    await pool.query(`delete from ${s()}.portal_codes`);
    await requestPortalCode(pool, s(), { confirmationNumber: confirmation, lastName: "tanaka " }, links);
    // nothing tells whether a booking matched
    await requestPortalCode(pool, s(), { confirmationNumber: "999999", lastName: "Nobody" }, links);
    mail.sent.length = 0;
    await dispatchMessages(pool, s(), tenant.id, { mail, sms: new FakeSmsProvider() }, { platformDomain: "mail.test" });
    // in the room's language (a new profile: the property's fallback)
    const sent = mail.sent.find((m) => /(Your|Ihr) [Cc]ode/.test(m.subject) && m.to === "aiko@example.com")!;
    const code = sent.subject.match(/(\d{6})$/)![1]!;
    const stored = (await pool.query(`select subject, secret_code from ${s()}.guest_messages where type = 'portal_code' order by created_at desc limit 1`)).rows[0];
    expect(stored.subject).not.toContain(code);
    expect(stored.secret_code).toBeNull();
    expect(await verifyPortalCode(pool, s(), { confirmationNumber: confirmation, lastName: "Tanaka", code: "000000" === code ? "111111" : "000000" })).toBeNull();
    const key = await verifyPortalCode(pool, s(), { confirmationNumber: confirmation, lastName: "Tanaka", code });
    expect(key).toBe((await portalKeys(pool, s(), reservationIds[0]!))!.booking);
    // used once
    expect(await verifyPortalCode(pool, s(), { confirmationNumber: confirmation, lastName: "Tanaka", code })).toBeNull();
  });

  it("the pre-arrival invitation carries the stay's Portal Link", async () => {
    await scanGuestMessages(pool, s(), new Date(), links);
    const keys = (await portalKeys(pool, s(), reservationIds[0]!))!;
    const pre = (await pool.query(`select body_text from ${s()}.guest_messages where reservation_id = $1 and type = 'pre_arrival'`, [reservationIds[0]])).rows[0];
    expect(pre.body_text).toContain(`${links.base}/g/${keys.reservation}`);
  });
});
