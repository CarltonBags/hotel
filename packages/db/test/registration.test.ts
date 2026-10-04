import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
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
import {
  addRegistrationPerson,
  completeRegistrationPerson,
  confirmSignedOnPaper,
  deleteExpiredRegistrations,
  findRegistration,
  openRegistration,
  recordIdCheck,
  sendToTablet,
  tabletState,
  tabletStep,
  takeBackFromTablet,
} from "../src/tenant/registration";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: who needs a form by country; a registration sent to a guest tablet
 * runs its guests in turn, one reservation per tablet; the guest's details go
 * back to the profile as tablet edits; completion needs the guest's part, the
 * confirmation and the ID Check; records are deleted on schedule.
 */
describe("Meldeschein registration", () => {
  let pool: Pool;
  let tenant: Tenant;
  const props: Record<"DE" | "AT", { id: string; book: (lastName: string, nationality: string) => Promise<string> }> = {} as never;
  const fd = "user_frida";
  const today = todayIn("Europe/Berlin");
  const s = () => tenant.schemaName;
  const tablet = { id: "", name: "Lobby iPad" };
  let tablet2 = "";

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    for (const country of ["DE", "AT"] as const) {
      const le = (await createLegalEntity(pool, s(), { name: `${country} GmbH`, country, addressLine1: "Ring 1", postalCode: "1010", city: country === "AT" ? "Wien" : "Berlin", vatId: `${country}U1`, taxNumber: "1" })).id;
      const id = (await createProperty(pool, s(), { name: `Haus ${country}`, legalEntityId: le, country, timeZone: "Europe/Berlin", currency: "EUR" })).id;
      const dbl = (await createRoomType(pool, s(), { propertyId: id, code: "DBL", name: "Double", maxOccupancy: 4, maxAdults: 2, bedPlaces: 2, extraBeds: 2 })).id;
      await createRooms(pool, s(), { propertyId: id, roomTypeId: dbl, numbers: Array.from({ length: 10 }, (_, i) => String(101 + i)) });
      await applyTaxPreset(pool, s(), le, country);
      const codes = await listTaxCodes(pool, s(), le);
      const room = await createService(pool, s(), { propertyId: id, code: "ROOM", name: "Room", defaultPrice: 0, taxCodeId: codes.find((c) => c.code === "ACC")!.id, revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
      const pay = await createPaymentPolicy(pool, s(), { propertyId: id, name: "Card", kind: "card_guarantee" });
      const cxl = await createCancellationPolicy(pool, s(), { propertyId: id, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
      const plan = await createRatePlan(pool, s(), { propertyId: id, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
      await setRates(pool, s(), id, fd, Array.from({ length: 5 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price: 100 })));
      props[country] = {
        id,
        book: async (lastName, nationality) => {
          const g = (await createGuest(pool, s(), { firstName: "Aiko", lastName, nationality, addressLine1: "1-2-3 Shibuya", postalCode: "150-0002", city: "Tokyo", countryOfResidence: "JP" }, { userId: fd, propertyId: id })).id;
          return (await createBooking(pool, s(), id, fd, { booker: { guestId: g }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: addDays(today, 2), roomTypeId: dbl, ratePlanId: plan.id, adults: 2, childAges: [], primaryGuestId: g }] })).reservations[0]!.id;
        },
      };
    }
    const { rows } = await pool.query<{ id: string }>(
      `insert into control.devices (tenant_id, property_id, kind, name, token_hash, enrolled_by) values ($1, $2, 'guest', 'Lobby iPad', 'h1', 'x'), ($1, $2, 'guest', 'Lobby iPad 2', 'h2', 'x') returning id`,
      [tenant.id, props.AT.id],
    );
    tablet.id = rows[0]!.id;
    tablet2 = rows[1]!.id;
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("a German national at a German property needs no form; a foreign family gets one form with counts", async () => {
    const german = await openRegistration(pool, s(), await props.DE.book("Müller", "DE"), fd);
    expect(german.persons.map((p) => p.need)).toEqual(["none"]);
    const res = await props.DE.book("Tanaka", "JP");
    const reg = await openRegistration(pool, s(), res, fd);
    await addRegistrationPerson(pool, s(), reg.id, { role: "spouse", firstName: "Kenji", lastName: "Tanaka", dateOfBirth: "1985-02-02", nationality: "JP" });
    await addRegistrationPerson(pool, s(), reg.id, { role: "child", firstName: "Mio", lastName: "Tanaka", dateOfBirth: "2018-03-03", nationality: "JP" });
    expect((await findRegistration(pool, s(), res))!.persons.map((p) => [p.firstName, p.need])).toEqual([["Aiko", "own_form"], ["Kenji", "counted"], ["Mio", "counted"]]);
  });

  it("Austria: the tablet runs each guest in turn; details go back to the profile as tablet edits; the guest signs", async () => {
    const res = await props.AT.book("Brandt", "DE");
    const reg = await openRegistration(pool, s(), res, fd);
    await addRegistrationPerson(pool, s(), reg.id, { role: "other", firstName: "Lukas", lastName: "Weiss", dateOfBirth: "1990-01-01", nationality: "AT" });
    await addRegistrationPerson(pool, s(), reg.id, { role: "child", firstName: "Lea", lastName: "Brandt", dateOfBirth: "2016-01-01", nationality: "DE" });
    await sendToTablet(pool, s(), { registrationId: reg.id, deviceId: tablet.id });
    // one reservation per tablet
    const other = await openRegistration(pool, s(), await props.AT.book("Durand", "FR"), fd);
    await expect(sendToTablet(pool, s(), { registrationId: other.id, deviceId: tablet.id })).rejects.toThrow(/busy/);
    let state = (await tabletState(pool, s(), tablet.id))!;
    expect(state).toMatchObject({ country: "AT", next: 1, person: { firstName: "Aiko", step: "welcome" } });
    // a step for someone not on the tablet is refused
    await expect(tabletStep(pool, s(), tablet, other.persons[0]!.id, { step: "welcome", language: "en" })).rejects.toThrow(/Not on this tablet/);
    const me = state.person.id;
    await tabletStep(pool, s(), tablet, me, { step: "welcome", language: "en" });
    await tabletStep(pool, s(), tablet, me, { step: "details", details: { firstName: "Aiko", lastName: "Brandt", dateOfBirth: "1988-04-12", nationality: "de", addressLine1: "Ringstraße 5", postalCode: "1010", city: "Wien", country: "AT", documentNumber: "C01X00T47", gender: "f" } });
    await tabletStep(pool, s(), tablet, me, { step: "companions", add: [] });
    await expect(tabletStep(pool, s(), tablet, me, { step: "review", signaturePng: null })).rejects.toThrow(/signature/);
    await tabletStep(pool, s(), tablet, me, { step: "review", signaturePng: Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")) });
    const changes = (await pool.query(`select field, user_id from ${s()}.guest_changes c join ${s()}.reservations r on r.primary_guest_id = c.guest_id where r.id = $1 and c.user_id like 'tablet:%'`, [res])).rows;
    expect(changes.map((c) => c.field)).toEqual(expect.arrayContaining(["dateOfBirth", "addressLine1", "documentNumber"]));
    expect(changes[0]!.user_id).toBe("tablet:Lobby iPad");
    // the next guest's turn
    state = (await tabletState(pool, s(), tablet.id))!;
    expect(state.person).toMatchObject({ firstName: "Lukas", step: "welcome" });
    // the desk takes it back: Lukas starts again next time
    await takeBackFromTablet(pool, s(), reg.id);
    expect(await tabletState(pool, s(), tablet.id)).toBeNull();
    // complete Aiko: signed on the tablet, ID Check recorded
    await expect(completeRegistrationPerson(pool, s(), me)).rejects.toThrow(/ID Check/);
    await recordIdCheck(pool, s(), me, "", fd);
    await completeRegistrationPerson(pool, s(), me);
    // the stored form carries the signature image
    expect((await pool.query(`select position('/Subtype /Image'::bytea in pdf) > 0 as img from ${s()}.registration_persons where id = $1`, [me])).rows[0].img).toBe(true);
    await expect(recordIdCheck(pool, s(), me, "later", fd)).rejects.toThrow(/completed already/);
    const view = (await findRegistration(pool, s(), res))!;
    expect(view.persons.map((p) => [p.firstName, p.need, p.confirmation, p.completed])).toEqual([
      ["Aiko", "own_form", "tablet_signature", true],
      ["Lukas", "own_form", null, false],
      ["Lea", "counted", null, false],
    ]);
    // another tablet may take the other reservation now
    await sendToTablet(pool, s(), { registrationId: other.id, deviceId: tablet2 });
  });

  it("Germany: signed on paper at the desk after the guest's part", async () => {
    const res = await props.DE.book("Smith", "GB");
    const reg = await openRegistration(pool, s(), res, fd);
    const p = reg.persons[0]!.id;
    await expect(confirmSignedOnPaper(pool, s(), p, fd)).rejects.toThrow(/comes first/);
  });

  it("deletion: a German record on day 400 goes, an Austrian one stays", async () => {
    const before = (await pool.query(`select g.country, count(*)::int as n from ${s()}.registrations g group by 1 order by 1`)).rows;
    expect(before.length).toBe(2);
    const n = await deleteExpiredRegistrations(pool, s(), addDays(addDays(today, 2), 400));
    const after = (await pool.query(`select g.country, count(*)::int as n from ${s()}.registrations g group by 1 order by 1`)).rows;
    expect(after.map((r) => r.country)).toEqual(["AT"]);
    expect(n).toBe(before.find((r) => r.country === "DE")!.n);
  });
});
