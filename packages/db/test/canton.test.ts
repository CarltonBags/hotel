import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { CANTON_PRESETS, addDays, tessinCsv, tessinXml, todayIn } from "@hoteloftware/domain";
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
import { addPortalDocument, portalKeys, portalView, setPortalSettings } from "../src/tenant/portal";
import { addRegistrationPerson, completeRegistrationPerson, confirmSignedOnPaper, openRegistration, recordIdCheck, sendToTablet, setCantonProfile, tabletStep, tessinExport } from "../src/tenant/registration";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: a Swiss property's Canton Profile decides who registers and how;
 * Tessin keeps no document copy and exports in its published format (the
 * XML validated against the cantonal schema); a handwritten signature hands
 * the Guest Portal over to reception.
 */
describe("Switzerland: Canton Profiles", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let book: (lastName: string, nationality: string) => Promise<string>;
  const fd = "user_frida";
  const today = todayIn("Europe/Zurich");
  const s = () => tenant.schemaName;
  const tablet = { id: "", name: "Lobby iPad" };

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "Lago AG", country: "CH", addressLine1: "Via Lago 1", postalCode: "6900", city: "Lugano", vatId: "CHE-123.456.789 MWST", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s(), { name: "Albergo Lago", legalEntityId: le, country: "CH", timeZone: "Europe/Zurich", currency: "CHF" })).id;
    const dbl = (await createRoomType(pool, s(), { propertyId, code: "DBL", name: "Double", maxOccupancy: 4, maxAdults: 2, bedPlaces: 2, extraBeds: 2 })).id;
    await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: ["101", "102", "103", "104", "105", "106", "107", "108"] });
    await applyTaxPreset(pool, s(), le, "CH");
    const codes = await listTaxCodes(pool, s(), le);
    const room = await createService(pool, s(), { propertyId, code: "ROOM", name: "Room", defaultPrice: 0, taxCodeId: codes[0]!.id, revenueAccount: "3400", postingRhythm: "per_night", bookableOnline: false });
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s(), { propertyId, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), propertyId, fd, Array.from({ length: 5 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price: 150 })));
    book = async (lastName, nationality) => {
      const g = (await createGuest(pool, s(), { firstName: "Lena", lastName, nationality, dateOfBirth: "1985-03-04", addressLine1: "Bahnhofstrasse 1", postalCode: "8001", city: "Zürich", countryOfResidence: "CH" }, { userId: fd, propertyId })).id;
      return (await createBooking(pool, s(), propertyId, fd, { booker: { guestId: g }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: addDays(today, 2), roomTypeId: dbl, ratePlanId: plan.id, adults: 2, childAges: [], primaryGuestId: g }] })).reservations[0]!.id;
    };
    const { rows } = await pool.query<{ id: string }>(`insert into control.devices (tenant_id, property_id, kind, name, token_hash, enrolled_by) values ($1, $2, 'guest', 'Lobby iPad', 'h1', 'x') returning id`, [tenant.id, propertyId]);
    tablet.id = rows[0]!.id;
  });
  afterAll(() => pool.end());

  it("no registration before the Canton Profile is chosen", async () => {
    await expect(openRegistration(pool, s(), await book("Keller", "CH"), fd)).rejects.toThrow(/Canton Profile/);
  });

  it("Zürich registers all guests; Bern foreign guests only", async () => {
    await setCantonProfile(pool, s(), propertyId, CANTON_PRESETS.ZH);
    const zh = await openRegistration(pool, s(), await book("Meier", "CH"), fd);
    expect(zh.persons[0]!.need).toBe("own_form");
    await setCantonProfile(pool, s(), propertyId, CANTON_PRESETS.BE);
    const be = await openRegistration(pool, s(), await book("Huber", "CH"), fd);
    expect(be.persons[0]!.need).toBe("none");
    // a profile chosen later does not change a registration already open
    expect((await openRegistration(pool, s(), zh.reservationId, fd)).persons[0]!.need).toBe("own_form");
  });

  it("every Swiss guest needs a date of birth and a Country of Residence", async () => {
    const reg = await openRegistration(pool, s(), await book("Rossi", "IT"), fd);
    await expect(addRegistrationPerson(pool, s(), reg.id, { role: "spouse", firstName: "Anna", lastName: "Rossi", dateOfBirth: null, nationality: "IT" })).rejects.toThrow(/date of birth/);
    await addRegistrationPerson(pool, s(), reg.id, { role: "spouse", firstName: "Anna", lastName: "Rossi", dateOfBirth: "1987-07-07", nationality: "IT", countryOfResidence: "IT" });
  });

  it("Tessin refuses a document image; the portal hands the signature over to reception", async () => {
    await setCantonProfile(pool, s(), propertyId, { ...CANTON_PRESETS.TI, tiUserId: "XNA9999" });
    await setPortalSettings(pool, s(), propertyId, { info: {}, documentImages: true });
    const id = await book("Bernasconi", "CH");
    const key = (await portalKeys(pool, s(), id))!.reservation;
    const view = await portalView(pool, s(), key);
    expect(view?.property).toMatchObject({ documentImages: false, registrationAtReception: true });
    await expect(addPortalDocument(pool, s(), key, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/at reception/);
  });

  it("a Tessin registration on the tablet, signed by hand, exports in Tessin's formats; the XML validates against the cantonal schema", async () => {
    const id = await book("Bianchi", "IT");
    const reg = await openRegistration(pool, s(), id, fd);
    await addRegistrationPerson(pool, s(), reg.id, { role: "child", firstName: "Luca", lastName: "Bianchi", dateOfBirth: addDays(today, -365 * 8), nationality: "IT", countryOfResidence: "IT" });
    await sendToTablet(pool, s(), { registrationId: reg.id, deviceId: tablet.id });
    const head = reg.persons[0]!.id;
    await tabletStep(pool, s(), tablet, head, { step: "welcome", language: "de" });
    const details = { firstName: "Marco", lastName: "Bianchi", dateOfBirth: "1980-02-03", nationality: "IT", addressLine1: "Via Roma 5", postalCode: "20121", city: "Milano", country: "IT", documentNumber: "YA1234567", gender: "m", carNumber: "MI123AB" };
    await expect(tabletStep(pool, s(), tablet, head, { step: "details", details })).rejects.toThrow(/placeOfBirth/);
    await tabletStep(pool, s(), tablet, head, { step: "details", details: { ...details, placeOfBirth: "Como", documentType: "passport" } });
    await tabletStep(pool, s(), tablet, head, { step: "companions", add: [] });
    await tabletStep(pool, s(), tablet, head, { step: "review", signaturePng: null });
    await recordIdCheck(pool, s(), head, "", fd);
    await expect(completeRegistrationPerson(pool, s(), head)).rejects.toThrow(/signature/);
    await confirmSignedOnPaper(pool, s(), head, fd);
    await completeRegistrationPerson(pool, s(), head);
    const { records } = await tessinExport(pool, s(), propertyId, today, today);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ userId: "XNA9999", nationality: "IT", placeOfBirth: "Como", over14: 1, under14: 1, documentType: "passport", carNumber: "MI123AB" });
    expect(tessinCsv(records).split("\r\n")[1]).toMatch(/^XNA9999;Bianchi;Marco;03\.02\.1980;ITA;/);
    const dir = await mkdtemp(join(tmpdir(), "ti-"));
    await writeFile(join(dir, "r.xml"), tessinXml(records[0]!));
    const out = execFileSync("xmllint", ["--noout", "--schema", resolve(__dirname, "../../../docs/formats/ticino-F-Modello_4.xsd"), join(dir, "r.xml")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(out).toBe("");
  });
});
