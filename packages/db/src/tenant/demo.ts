import type { Pool } from "pg";
import { FakePaymentProvider } from "@hoteloftware/payments";
import { PRICE_HORIZON_DAYS, addDays, todayIn } from "@hoteloftware/domain";
import { createLegalEntity } from "./legal-entities";
import { createProperty } from "./properties";
import { createRoomType, createRooms, type Room } from "./rooms";
import { applyTaxPreset, listTaxCodes } from "./tax-codes";
import { createService } from "./services";
import { createCancellationPolicy, createPaymentPolicy } from "./policies";
import { createRatePlan } from "./rate-plans";
import { setRates } from "./rates";
import { createGuest } from "./guests";
import { createBooking } from "./reservations";
import { assignRoom } from "./reservation-changes";
import { checkIn, loadFolios } from "./folios";
import { checkOut, setInvoiceNumberRange } from "./invoices";
import { takePayment } from "./payments";
import { createCityTaxRule } from "./city-tax";
import { closeNightAudit } from "./night-audit";
import { withTenant } from "./with-tenant";

const TZ = "Europe/Berlin";
const HISTORY_DAYS = 7;

const GUESTS: [string, string, string, string, string, string][] = [
  ["Aiko", "Tanaka", "1-2-3 Shibuya", "150-0002", "Tokyo", "JP"],
  ["Lena", "Fischer", "Hauptstraße 12", "80331", "München", "DE"],
  ["Marco", "Rossi", "Via Roma 5", "00184", "Roma", "IT"],
  ["Sophie", "Martin", "12 rue de Rivoli", "75001", "Paris", "FR"],
  ["James", "Wilson", "22 Baker Street", "NW1 6XE", "London", "GB"],
  ["Anna", "Kowalska", "ul. Długa 7", "00-238", "Warszawa", "PL"],
  ["Lucas", "Jansen", "Damrak 40", "1012 LK", "Amsterdam", "NL"],
  ["Emma", "Schulz", "Lindenallee 3", "50668", "Köln", "DE"],
  ["Olivia", "Brown", "500 Market St", "94105", "San Francisco", "US"],
  ["Noah", "Huber", "Mariahilfer Straße 1", "1060", "Wien", "AT"],
  ["Mia", "Keller", "Bahnhofstrasse 10", "8001", "Zürich", "CH"],
  ["Felix", "Wagner", "Königsallee 20", "40212", "Düsseldorf", "DE"],
];

/**
 * The demo property of a demo trial (ticket 87): rooms, rates 500 days
 * ahead, guests, a week of history (stays checked in, out and invoiced, one
 * Night Audit a day) and upcoming reservations. Made through the same
 * operations as real work, so every record is consistent; the tenant is in
 * Test Mode, so its invoices carry test numbers.
 */
export async function seedDemoData(pool: Pool, schema: string, userId: string): Promise<{ propertyId: string }> {
  const provider = new FakePaymentProvider();
  const today = todayIn(TZ);
  const start = addDays(today, -HISTORY_DAYS);
  const le = (await createLegalEntity(pool, schema, { name: "Demo Hotel GmbH", country: "DE", addressLine1: "Friedrichstraße 100", postalCode: "10117", city: "Berlin", vatId: "DE999999999", taxNumber: "30/000/00000" })).id;
  const propertyId = (await createProperty(pool, schema, { name: "Demo Hotel Berlin", legalEntityId: le, country: "DE", timeZone: TZ, currency: "EUR" })).id;
  // the history is lived through: the property starts a week ago and its audits bring it to today
  await withTenant(pool, schema, (tx) => tx.query("update properties set business_date = $2 where id = $1", [propertyId, start]));
  const dbl = (await createRoomType(pool, schema, { propertyId, code: "DBL", name: "Double room", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
  const sgl = (await createRoomType(pool, schema, { propertyId, code: "SGL", name: "Single room", maxOccupancy: 1, maxAdults: 1, bedPlaces: 1, extraBeds: 0 })).id;
  const rooms: Room[] = [
    ...(await createRooms(pool, schema, { propertyId, roomTypeId: dbl, numbers: Array.from({ length: 20 }, (_, i) => String(101 + i)) })),
    ...(await createRooms(pool, schema, { propertyId, roomTypeId: sgl, numbers: Array.from({ length: 8 }, (_, i) => String(201 + i)) })),
  ];
  await applyTaxPreset(pool, schema, le, "DE");
  const codes = await listTaxCodes(pool, schema, le);
  const code = (c: string) => codes.find((x) => x.code === c)!.id;
  const room = await createService(pool, schema, { propertyId, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: code("ACC"), revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
  const brk = await createService(pool, schema, { propertyId, code: "BRK", name: "Frühstück", defaultPrice: 15, taxCodeId: code("FOOD"), revenueAccount: "8400", postingRhythm: "per_person_night", bookableOnline: true });
  await createService(pool, schema, { propertyId, code: "MINI", name: "Minibar", defaultPrice: 4.5, taxCodeId: code("STD"), revenueAccount: "8410", postingRhythm: "once", bookableOnline: false });
  await createService(pool, schema, { propertyId, code: "PARK", name: "Parken", defaultPrice: 18, taxCodeId: code("STD"), revenueAccount: "8420", postingRhythm: "per_night", bookableOnline: true });
  const pay = await createPaymentPolicy(pool, schema, { propertyId, name: "Card guarantee", kind: "card_guarantee" });
  const cxl = await createCancellationPolicy(pool, schema, { propertyId, name: "Flexible", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
  const plan = await createRatePlan(pool, schema, { propertyId, code: "BB", name: "Bed and breakfast", kind: "base", roomTypeIds: [dbl, sgl], baseOccupancy: 1, mealPlan: "breakfast", accommodationServiceId: room.id, includedServices: [{ serviceId: brk.id, componentPrice: 15 }], paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
  const days = Array.from({ length: HISTORY_DAYS + PRICE_HORIZON_DAYS + 1 }, (_, n) => addDays(start, n));
  // weekends dearer
  const price = (date: string, base: number) => ([5, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) ? base + 30 : base);
  await setRates(pool, schema, propertyId, userId, days.flatMap((date) => [
    { ratePlanId: plan.id, roomTypeId: dbl, date, price: price(date, 129) },
    { ratePlanId: plan.id, roomTypeId: sgl, date, price: price(date, 99) },
  ]));
  await createCityTaxRule(pool, schema, propertyId, { preset: "berlin", taxCodeId: code("ZERO") }, userId);
  await setInvoiceNumberRange(pool, schema, le, "final", "RE-{YYYY}-{NNNNN}");
  const guests: string[] = [];
  for (const [firstName, lastName, addressLine1, postalCode, city, countryOfResidence] of GUESTS) {
    guests.push((await createGuest(pool, schema, { firstName, lastName, addressLine1, postalCode, city, countryOfResidence }, { userId, propertyId })).id);
  }
  const book = async (arrival: string, nights: number, n: number) => {
    const single = n % 4 === 3;
    const guestId = guests[n % guests.length]!;
    const { reservations } = await createBooking(pool, schema, propertyId, userId, {
      booker: { guestId },
      walkIn: false,
      notes: "",
      reservations: [{ arrival, departure: addDays(arrival, nights), roomTypeId: single ? sgl : dbl, ratePlanId: plan.id, adults: single ? 1 : 2, childAges: [], primaryGuestId: guestId }],
    });
    return { id: reservations[0]!.id, single, departure: addDays(arrival, nights) };
  };

  // a week lived through: each day guests leave (paid, invoiced), others arrive into fresh rooms, the audit closes the day
  const inHouse: { id: string; departure: string }[] = [];
  const free = { dbl: rooms.filter((r) => r.roomTypeId === dbl), sgl: rooms.filter((r) => r.roomTypeId === sgl) };
  let n = 0;
  for (let d = 0; d < HISTORY_DAYS; d++) {
    const date = addDays(start, d);
    for (const stay of inHouse.filter((s) => s.departure === date)) {
      const guestFolio = (await loadFolios(pool, schema, stay.id)).folios[0]!;
      if (guestFolio.balance > 0) await takePayment(pool, schema, provider, { reservationId: stay.id, tender: "bank_transfer", amount: guestFolio.balance, reference: "Demo" }, userId);
      await checkOut(pool, schema, stay.id, userId, { override: false });
      inHouse.splice(inHouse.indexOf(stay), 1);
    }
    for (let a = 0; a < 3; a++, n++) {
      const stay = await book(date, 1 + (n % 3), n);
      const r = (stay.single ? free.sgl : free.dbl).shift();
      if (!r) continue;
      await assignRoom(pool, schema, stay.id, userId, r.id);
      await checkIn(pool, schema, stay.id, userId);
      inHouse.push(stay);
    }
    await closeNightAudit(pool, schema, propertyId, userId);
  }
  // the weeks ahead: arrivals for the desk to work with
  for (let d = 0; d < 21; d++) for (let a = 0; a < 2; a++, n++) await book(addDays(today, d), 1 + (n % 4), n);
  return { propertyId };
}
