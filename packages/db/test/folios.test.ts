import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
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
import { createRatePlan, updateRatePlan, type RatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createCompany } from "../src/tenant/companies";
import { createBooking } from "../src/tenant/reservations";
import { assignRoom, cancelReservation, listFreeRooms, moveRoomInHouse, ShorteningNeedsConfirmation, updateReservation } from "../src/tenant/reservation-changes";
import { addFolio, checkIn, chargeHistory, loadFolios, moveCharge, postFreeTextCharge, postServiceCharge, voidCharge } from "../src/tenant/folios";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: check-in posts every night per component (ADR 0009) as gross Charges
 * with Tax Codes (ADR 0010) onto routed Folios; Charges move, void with a
 * reason, and follow later stay changes.
 */
describe("check-in and folios", () => {
  let pool: Pool;
  let tenant: Tenant;
  let berlin: string;
  let dbl: string;
  let rooms: Room[];
  let bar: RatePlan;
  let guest: string;
  let acme: string;
  let minibar: string;
  let food: string;
  const fd = "user_frida";
  const today = todayIn("Europe/Berlin");
  const day = (n: number) => addDays(today, n);
  let res: string;

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const s = tenant.schemaName;
    const le = await createLegalEntity(pool, s, { name: "Alpha GmbH", country: "DE" });
    berlin = (await createProperty(pool, s, { name: "Berlin", legalEntityId: le.id, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    dbl = (await createRoomType(pool, s, { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 3, maxAdults: 3, bedPlaces: 2, extraBeds: 1 })).id;
    rooms = await createRooms(pool, s, { propertyId: berlin, roomTypeId: dbl, numbers: ["101", "102"] });
    await applyTaxPreset(pool, s, le.id, "DE");
    const codes = await listTaxCodes(pool, s, le.id);
    const acc = codes.find((c) => c.code === "ACC")!.id;
    food = codes.find((c) => c.code === "FOOD")!.id;
    const room = await createService(pool, s, { propertyId: berlin, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: acc, revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const brk = await createService(pool, s, { propertyId: berlin, code: "BRK", name: "Frühstück", defaultPrice: 18, taxCodeId: food, revenueAccount: "8400", postingRhythm: "per_person_night", bookableOnline: false });
    minibar = (await createService(pool, s, { propertyId: berlin, code: "MINI", name: "Minibar", defaultPrice: 4.5, taxCodeId: codes.find((c) => c.code === "STD")!.id, revenueAccount: "8410", postingRhythm: "once", bookableOnline: false })).id;
    const pay = await createPaymentPolicy(pool, s, { propertyId: berlin, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s, { propertyId: berlin, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    bar = await createRatePlan(pool, s, {
      propertyId: berlin,
      code: "BB",
      name: "Bed and breakfast",
      kind: "base",
      roomTypeIds: [dbl],
      mealPlan: "breakfast",
      accommodationServiceId: room.id,
      includedServices: [{ serviceId: brk.id, componentPrice: 12 }],
      earlyDepartureFeeKind: "first_night",
      paymentPolicyId: pay.id,
      cancellationPolicyId: cxl.id,
    });
    await setRates(pool, s, berlin, fd, [0, 1, 2, 3, 4, 5].map((n) => ({ ratePlanId: bar.id, roomTypeId: dbl, date: day(n), price: 150 })));
    guest = (await createGuest(pool, s, { firstName: "Aiko", lastName: "Tanaka" }, { userId: fd, propertyId: berlin })).id;
    acme = (await createCompany(pool, s, { name: "Acme AG", routing: ["accommodation"] }, { userId: fd })).id;
    const b = await createBooking(pool, s, berlin, fd, { booker: { companyId: acme }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: day(3), roomTypeId: dbl, ratePlanId: bar.id, adults: 2, childAges: [], primaryGuestId: guest }] });
    res = b.reservations[0]!.id;
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("a booking opens its folios: the Primary Guest's, and the Company's with its Routing Rules", async () => {
    const f = await loadFolios(pool, tenant.schemaName, res);
    expect(f.folios.map((x) => [x.number, x.billTo, x.billToName])).toEqual([
      [1, "guest", "Aiko Tanaka"],
      [2, "company", "Acme AG"],
    ]);
    expect(f.routing).toEqual([{ category: "accommodation", folioId: f.folios[1]!.id }]);
  });

  it("check-in needs a room", async () => {
    await expect(checkIn(pool, tenant.schemaName, res, fd)).rejects.toThrow(/room/i);
  });

  it("check-in of a 3-night package posts 6 Charges with Service Dates and Tax Codes, routed by the Company's rules", async () => {
    await assignRoom(pool, tenant.schemaName, res, fd, rooms[0]!.id);
    await checkIn(pool, tenant.schemaName, res, fd);
    const f = await loadFolios(pool, tenant.schemaName, res);
    expect(f.folios.map((x) => x.billToName)).toEqual(["Aiko Tanaka", "Acme AG"]);
    const all = f.folios.flatMap((x) => x.charges);
    expect(all).toHaveLength(6);
    // room: 150 - 2 × 12 breakfast = 126 per night under ACC 7 %, on the Company's folio (accommodation routed)
    const roomCharges = f.folios[1]!.charges;
    expect(roomCharges.map((c) => [c.serviceDate, c.description, c.amount, c.taxCode, c.taxRate])).toEqual([0, 1, 2].map((n) => [day(n), "Übernachtung", 126, "ACC", 7]));
    // breakfast: 2 persons × 12 under FOOD 7 % on the guest's folio
    expect(f.folios[0]!.charges.map((c) => [c.serviceDate, c.quantity, c.amount, c.taxCode])).toEqual([0, 1, 2].map((n) => [day(n), 2, 24, "FOOD"]));
    expect(f.folios[0]!.totals.gross).toBe(72);
  });

  it("moving a Charge to the Company folio shows it in net plus VAT there", async () => {
    let f = await loadFolios(pool, tenant.schemaName, res);
    const brk = f.folios[0]!.charges[0]!;
    await moveCharge(pool, tenant.schemaName, res, brk.id, f.folios[1]!.id, fd);
    f = await loadFolios(pool, tenant.schemaName, res);
    const company = f.folios[1]!;
    expect(company.billTo).toBe("company");
    expect(company.totals.byTaxCode).toEqual([
      { taxCode: "ACC", rate: 7, gross: 378, net: 353.27, vat: 24.73 },
      { taxCode: "FOOD", rate: 7, gross: 24, net: 22.43, vat: 1.57 },
    ]);
  });

  it("voiding needs a reason and leaves the Charge visible with its log", async () => {
    const post = await postServiceCharge(pool, tenant.schemaName, res, { serviceId: minibar, quantity: 2, serviceDate: today }, fd);
    await expect(voidCharge(pool, tenant.schemaName, res, post.id, "  ", fd)).rejects.toThrow(/reason/i);
    await voidCharge(pool, tenant.schemaName, res, post.id, "Booked on the wrong room", fd);
    const f = await loadFolios(pool, tenant.schemaName, res);
    const voided = f.folios.flatMap((x) => x.charges).find((c) => c.id === post.id)!;
    expect(voided).toMatchObject({ amount: 9, voided: true, voidReason: "Booked on the wrong room" });
    expect(f.folios[0]!.totals.gross).toBe(48);
    expect((await chargeHistory(pool, tenant.schemaName, res)).filter((e) => e.chargeId === post.id).map((e) => e.action)).toEqual(["post", "void"]);
    await expect(voidCharge(pool, tenant.schemaName, res, post.id, "again", fd)).rejects.toThrow(/already voided/);
  });

  it("free-text Charges need a Tax Code of the property's Legal Entity", async () => {
    const c = await postFreeTextCharge(pool, tenant.schemaName, res, { description: "Late checkout", amount: 30, taxCodeId: food, serviceDate: today }, fd);
    expect(c).toMatchObject({ description: "Late checkout", amount: 30, origin: "free_text" });
    await expect(postFreeTextCharge(pool, tenant.schemaName, res, { description: "", amount: 30, taxCodeId: food, serviceDate: today }, fd)).rejects.toThrow(/description/i);
  });

  it("extending posts the added night at once", async () => {
    await updateReservation(pool, tenant.schemaName, res, fd, { departure: day(4) });
    const f = await loadFolios(pool, tenant.schemaName, res);
    const live = f.folios.flatMap((x) => x.charges).filter((c) => c.origin === "stay" && !c.voided);
    expect(live.filter((c) => c.serviceDate === day(3)).map((c) => c.amount).sort((a, b) => a - b)).toEqual([24, 126]);
  });

  it("shortening proposes the voids and posts the early-departure fee only after confirmation", async () => {
    let proposal: ShorteningNeedsConfirmation | null = null;
    try {
      await updateReservation(pool, tenant.schemaName, res, fd, { departure: day(2) });
    } catch (err) {
      if (err instanceof ShorteningNeedsConfirmation) proposal = err;
      else throw err;
    }
    expect(proposal).not.toBeNull();
    expect(proposal!.voids.map((v) => v.serviceDate).sort()).toEqual([day(2), day(2), day(3), day(3)]);
    expect(proposal!.fee).toBe(150);
    // nothing changed yet
    expect((await loadFolios(pool, tenant.schemaName, res)).folios.flatMap((x) => x.charges).filter((c) => c.voided).length).toBe(1);
    await updateReservation(pool, tenant.schemaName, res, fd, { departure: day(2) }, { confirmShortening: true });
    const f = await loadFolios(pool, tenant.schemaName, res);
    const charges = f.folios.flatMap((x) => x.charges);
    expect(charges.filter((c) => c.origin === "stay" && !c.voided).map((c) => c.serviceDate).every((d) => d < day(2))).toBe(true);
    expect(charges.filter((c) => c.origin === "fee").map((c) => [c.amount, c.description])).toEqual([[150, "Early departure fee"]]);
  });

  it("a room-type change in house voids and reposts the nights from the move on", async () => {
    const s = tenant.schemaName;
    const sui = (await createRoomType(pool, s, { propertyId: berlin, code: "SUI", name: "Suite", maxOccupancy: 3, maxAdults: 3, bedPlaces: 2, extraBeds: 1 })).id;
    const [suite] = await createRooms(pool, s, { propertyId: berlin, roomTypeId: sui, numbers: ["301"] });
    await updateRatePlan(pool, s, berlin, bar.id, { roomTypeIds: [dbl, sui] });
    await setRates(pool, s, berlin, fd, [0, 1, 2].map((n) => ({ ratePlanId: bar.id, roomTypeId: sui, date: day(n), price: 200 })));
    expect((await listFreeRooms(pool, s, res, day(1), { anyType: true })).map((r) => r.name)).toContain("301 · SUI");
    await moveRoomInHouse(pool, s, res, fd, suite!.id, day(1));
    const live = (await loadFolios(pool, s, res)).folios.flatMap((x) => x.charges).filter((c) => c.origin === "stay" && !c.voided);
    // night 0 keeps its posted price; night 1 is reposted at the Suite price (200 - 24 breakfast)
    expect(live.filter((c) => c.description === "Übernachtung").map((c) => [c.serviceDate, c.amount])).toEqual([
      [day(0), 126],
      [day(1), 176],
    ]);
  });

  it("a night voided by hand stays settled when the stay is repriced", async () => {
    const s = tenant.schemaName;
    let f = await loadFolios(pool, s, res);
    const breakfast = f.folios.flatMap((x) => x.charges).find((c) => c.origin === "stay" && !c.voided && c.serviceDate === day(1) && c.description === "Frühstück")!;
    await voidCharge(pool, s, res, breakfast.id, "Stay changed", fd);
    // one more adult reprices the nights from today on; the breakfast given for free is not posted again
    await updateReservation(pool, s, res, fd, { adults: 3 });
    f = await loadFolios(pool, s, res);
    const live = f.folios.flatMap((x) => x.charges).filter((c) => c.origin === "stay" && !c.voided);
    expect(live.filter((c) => c.serviceDate === day(1) && c.description === "Frühstück")).toEqual([]);
    expect(live.filter((c) => c.serviceDate === day(1) && c.description === "Übernachtung")).toHaveLength(1);
  });

  it("a reservation with open Charges is not cancelled", async () => {
    const s = tenant.schemaName;
    const b = await createBooking(pool, s, berlin, fd, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [{ arrival: day(4), departure: day(5), roomTypeId: dbl, ratePlanId: bar.id, adults: 1, childAges: [], primaryGuestId: guest }] });
    const other = b.reservations[0]!.id;
    const c = await postServiceCharge(pool, s, other, { serviceId: minibar, quantity: 1 }, fd);
    await expect(cancelReservation(pool, s, other, fd)).rejects.toThrow(/open Charges/);
    await voidCharge(pool, s, other, c.id, "Posted ahead by mistake", fd);
    await expect(cancelReservation(pool, s, other, fd)).resolves.toBeTruthy();
  });

  it("staff add Folios with another Bill-to", async () => {
    const folio = await addFolio(pool, tenant.schemaName, res, { guestId: guest }, fd);
    expect(folio.number).toBe(3);
  });
});
