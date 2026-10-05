import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn, type Actor } from "@hoteloftware/domain";
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
import { createCompany } from "../src/tenant/companies";
import { createCityTaxRule } from "../src/tenant/city-tax";
import { setInvoiceNumberRange, invoiceDocument } from "../src/tenant/invoices";
import { loadFolios, postServiceCharge } from "../src/tenant/folios";
import { addHolding, createGroup, setGroupPrices, setGroupStatus } from "../src/tenant/groups";
import {
  assignGroupRooms,
  checkInGroup,
  createPlaceholderReservations,
  fillRoomingByToken,
  groupArrival,
  importRoomingList,
  invoiceMasterFolio,
  masterFolio,
  postGroupFee,
  previewRoomingList,
  remindGroupDeposits,
  roomingByToken,
  roomingLink,
  saveGroupRegistration,
  setDepositSchedule,
  setGroupRouting,
  takeGroupPayment,
} from "../src/tenant/group-billing";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: Held Rooms become placeholder reservations named from the rooming
 * list (mismatches flagged); the group's Routing Rules send room, breakfast
 * and City Tax to the Master Folio, extras stay on guest folios; one invoice
 * lists rooms and nights; rooms are assigned together by floor; the arrival
 * is checked in at once; deposits are invoiced and reminded.
 */
describe("Group billing and check-in", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let dbl = "";
  let basePlan = "";
  let company = "";
  let minibar = "";
  const s = () => tenant.schemaName;
  const today = todayIn("Europe/Berlin");
  const fd: { userId: string; actor: Actor } = { userId: "user_fd", actor: { propertyRoles: [] } };

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "A GmbH", country: "DE", addressLine1: "Ring 1", postalCode: "10115", city: "Berlin", vatId: "DE123456789", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s(), { name: "Haus am Ring", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    fd.actor = { propertyRoles: [{ propertyId, role: "front_desk" }] };
    dbl = (await createRoomType(pool, s(), { propertyId, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    // floor 1 has 10 Doubles, floor 2 has 22
    await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: Array.from({ length: 10 }, (_, i) => String(101 + i)) });
    await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: Array.from({ length: 22 }, (_, i) => String(201 + i)) });
    await pool.query(`update ${s()}.rooms set floor = left(number, 1)`);
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const code = (c: string) => codes.find((x) => x.code === c)!.id;
    const room = await createService(pool, s(), { propertyId, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: code("ACC"), revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const brk = await createService(pool, s(), { propertyId, code: "BRK", name: "Frühstück", defaultPrice: 18, taxCodeId: code("FOOD"), revenueAccount: "8400", postingRhythm: "per_person_night", bookableOnline: false });
    minibar = (await createService(pool, s(), { propertyId, code: "MINI", name: "Minibar", defaultPrice: 4.5, taxCodeId: code("STD"), revenueAccount: "8410", postingRhythm: "once", bookableOnline: false })).id;
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    basePlan = (await createRatePlan(pool, s(), {
      propertyId,
      code: "BB",
      name: "Bed and breakfast",
      kind: "base",
      roomTypeIds: [dbl],
      mealPlan: "breakfast",
      accommodationServiceId: room.id,
      includedServices: [{ serviceId: brk.id, componentPrice: 12 }],
      paymentPolicyId: pay.id,
      cancellationPolicyId: cxl.id,
    })).id;
    await setRates(pool, s(), propertyId, "user_rev", Array.from({ length: 60 }, (_, n) => ({ ratePlanId: basePlan, roomTypeId: dbl, date: addDays(today, n), price: 120 })));
    await setInvoiceNumberRange(pool, s(), le, "final", "RE-{YYYY}-{NNNNN}");
    await createCityTaxRule(pool, s(), propertyId, { preset: "berlin", taxCodeId: code("ZERO") }, "user_pm");
    company = (await createCompany(pool, s(), { name: "Reisen AG", addressLine1: "Hafen 2", postalCode: "20457", city: "Hamburg", country: "DE", billingEmail: "buchhaltung@reisen.example" }, { userId: fd.userId })).id;
  });
  afterAll(() => pool.end());

  const departure = addDays(today, 2);
  let group = "";
  let holding = "";

  it("Held Rooms become placeholder reservations; the rooming list flags a room type not held and a name over the held count", async () => {
    group = (await createGroup(pool, s(), { propertyId, name: "Chor Leipzig", organiser: { companyId: company }, contact: "Frau Lange", optionDate: null, terms: "30 % deposit 4 weeks ahead", reductionRules: "2 rooms free until 30 days", releaseDays: 0, basePlanId: basePlan }, fd)).id;
    holding = await addHolding(pool, s(), group, { arrival: today, departure, rooms: [{ roomTypeId: dbl, rooms: 20 }] }, fd);
    await setGroupStatus(pool, s(), group, "definite", fd);
    await setGroupPrices(pool, s(), group, [today, addDays(today, 1)].map((date) => ({ roomTypeId: dbl, date, price: 100 })), fd);
    await setGroupRouting(pool, s(), group, ["accommodation", "package", "city_tax"], fd);
    expect(await createPlaceholderReservations(pool, s(), holding, fd)).toBe(20);
    await expect(createPlaceholderReservations(pool, s(), holding, fd)).rejects.toThrow(/Every Held Room/);

    const list = ["Zimmerkategorie;Vorname;Nachname;Erwachsene", ...Array.from({ length: 21 }, (_, i) => `DBL;Sänger;Nr ${i + 1};2`), "SUI;Dirigent;Bach;1"].join("\n");
    const preview = await previewRoomingList(pool, s(), holding, list, fd);
    expect(preview.types).toEqual([{ code: "DBL", held: 20, named: 0, open: 20 }]);
    expect(preview.rows.filter((r) => r.problem).map((r) => [r.line, r.problem])).toEqual([
      [22, "over_held"],
      [23, "type_not_held"],
    ]);
    expect(await importRoomingList(pool, s(), holding, list, fd)).toEqual({ named: 20, booked: 0, skipped: 2 });
    const arrival = await groupArrival(pool, s(), holding, fd);
    expect(arrival.reservations).toHaveLength(20);
    expect(arrival.reservations.every((r) => !r.pending && r.guest.startsWith("Sänger Nr"))).toBe(true);
  });

  it("the organiser's link names a reservation until check-in", async () => {
    const token = await roomingLink(pool, s(), group, fd);
    const view = (await roomingByToken(pool, s(), token))!;
    const first = view.holdings[0]!.rooms[0]!;
    expect(await fillRoomingByToken(pool, s(), token, [{ reservationId: first.reservationId, firstName: "Clara", lastName: "Schumann" }])).toBe(1);
    expect((await roomingByToken(pool, s(), token))!.holdings[0]!.rooms.find((r) => r.reservationId === first.reservationId)).toMatchObject({ firstName: "Clara", lastName: "Schumann" });
    expect(await roomingByToken(pool, s(), "x".repeat(24))).toBeNull();
  });

  it("bulk assignment keeps the group on one floor when possible", async () => {
    expect(await assignGroupRooms(pool, s(), holding, "floor", fd)).toEqual({ assigned: 20, without: 0 });
    const rooms = (await groupArrival(pool, s(), holding, fd)).reservations.map((r) => r.room!);
    expect(new Set(rooms.map((r) => r[0]))).toEqual(new Set(["2"]));
    expect(new Set(rooms).size).toBe(20);
  });

  it("in Germany the tour leader of a group above ten persons registers for it", async () => {
    const a = await groupArrival(pool, s(), holding, fd);
    expect(a.persons).toBe(40);
    expect(a.registrationNeeded).toBe(true);
    await saveGroupRegistration(pool, s(), holding, { leaderFirstName: "Clara", leaderLastName: "Schumann", leaderNationality: "de", leaderBirthDate: null, leaderAddress: "Leipzig", members: [{ nationality: "FR", count: 12 }, { nationality: "AT", count: 27 }] }, fd);
    expect((await groupArrival(pool, s(), holding, fd)).registration).toMatchObject({ leaderNationality: "DE", members: [{ nationality: "FR", count: 12 }, { nationality: "AT", count: 27 }] });
  });

  it("group check-in of 20 reservations posts room, breakfast and City Tax to the Master Folio, extras to guest folios", async () => {
    expect(await checkInGroup(pool, s(), holding, null, fd)).toEqual({ checkedIn: 20, failed: [] });
    const arrival = await groupArrival(pool, s(), holding, fd);
    expect(arrival.reservations.every((r) => r.status === "checked_in")).toBe(true);
    const one = arrival.reservations[0]!.reservationId;
    await postServiceCharge(pool, s(), one, { serviceId: minibar, quantity: 2 }, fd.userId);

    const master = await masterFolio(pool, s(), group, fd);
    expect(master.billToName).toBe("Reisen AG");
    const live = master.charges.filter((c) => !c.voided);
    // 20 rooms × 2 nights: the room, breakfast for two and the City Tax each night
    const byKind = (d: string) => live.filter((c) => c.description === d).length;
    expect(byKind("Übernachtung")).toBe(40);
    expect(byKind("Frühstück")).toBe(40);
    expect(live.filter((c) => c.description !== "Übernachtung" && c.description !== "Frühstück").length).toBe(40);
    expect(live.every((c) => c.room?.startsWith("2"))).toBe(true);
    expect(live.some((c) => /Minibar/.test(c.description))).toBe(false);

    // the guest's own folio has only the extras
    const folios = await loadFolios(pool, s(), one);
    const own = folios.folios.find((f) => !f.master)!;
    expect(own.charges.map((c) => c.description)).toEqual(["Minibar"]);
    expect(folios.folios.find((f) => f.master)!.charges.length).toBe(6);
  });

  it("the Master Folio becomes one invoice listing rooms and nights", async () => {
    const inv = await invoiceMasterFolio(pool, s(), group, fd);
    const doc = await invoiceDocument(pool, s(), inv.id);
    expect(doc.reservationId).toBeNull();
    expect(doc.buyer.name).toBe("Reisen AG");
    expect(doc.reference).toBe("Chor Leipzig");
    // per room and Service, over its nights
    expect(doc.totals.lines.length).toBe(60);
    expect(doc.totals.lines[0]).toMatchObject({ quantity: 2, periodStart: today, periodEnd: addDays(today, 1) });
    expect(doc.totals.lines[0]!.description).toMatch(/^Zimmer 2\d\d · .+: Übernachtung$/);
    expect((await masterFolio(pool, s(), group, fd)).charges.every((c) => c.invoiced)).toBe(true);
  });

  it("a deposit before arrival gets its Deposit Invoice; an installment open after its date is reminded once", async () => {
    const later = (await createGroup(pool, s(), { propertyId, name: "Kongress", organiser: { companyId: company }, contact: "", optionDate: null, terms: "Cancellation: 50 %", reductionRules: "", releaseDays: 7, basePlanId: basePlan }, fd)).id;
    const h = await addHolding(pool, s(), later, { arrival: addDays(today, 30), departure: addDays(today, 32), rooms: [{ roomTypeId: dbl, rooms: 2 }] }, fd);
    await setGroupPrices(pool, s(), later, [30, 31].map((n) => ({ roomTypeId: dbl, date: addDays(today, n), price: 100 })), fd);
    await setDepositSchedule(pool, s(), later, [{ dueDate: addDays(today, -1), amount: 200 }, { dueDate: addDays(today, 10), amount: 200 }], fd);
    await expect(takeGroupPayment(pool, s(), later, { amount: 100, reference: "Kongress 1" }, fd)).rejects.toThrow(/reservations first/);
    await createPlaceholderReservations(pool, s(), h, fd);
    const paid = await takeGroupPayment(pool, s(), later, { amount: 100, reference: "Kongress 1" }, fd);
    expect(paid.depositInvoice?.kind).toBe("deposit");
    const view = await masterFolio(pool, s(), later, fd);
    expect(view.deposits.map((d) => [d.paid, d.open, d.overdue])).toEqual([
      [100, 100, true],
      [0, 200, false],
    ]);
    expect(await remindGroupDeposits(pool, s())).toMatchObject([{ groupName: "Kongress", open: 100, mailed: true }]);
    expect(await remindGroupDeposits(pool, s())).toEqual([]);
    const mail = (await pool.query(`select to_email, body from ${s()}.mail_outbox where group_id = $1`, [later])).rows;
    expect(mail).toHaveLength(1);
    expect(mail[0].to_email).toBe("buchhaltung@reisen.example");

    // a shrink: staff read the contract and post the fee on the Master Folio
    await postGroupFee(pool, s(), later, { description: "Reduction fee, 1 room", amount: 100 }, fd);
    expect((await masterFolio(pool, s(), later, fd)).charges.map((c) => [c.description, c.amount, c.reservationId])).toEqual([["Reduction fee, 1 room", 100, null]]);
  });
});
