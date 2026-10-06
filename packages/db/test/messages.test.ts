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
import { cancelReservation } from "../src/tenant/reservation-changes";
import {
  checkSenderDomain,
  dispatchMessages,
  messagingSettings,
  recordMailEvent,
  reservationMessages,
  resetMessageText,
  messageText,
  scanGuestMessages,
  setMessageText,
  setMessagingSettings,
  setSenderDomain,
} from "../src/tenant/messages";
import { queueSms } from "../src/tenant/mail-outbox";
import { assignRoom } from "../src/tenant/reservation-changes";
import { checkIn } from "../src/tenant/folios";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: the scan derives each message once from what happened, in the
 * guest's language and the property's look; service messages wait for
 * Sending Hours; dispatch sends through the provider; delivery events mark
 * state, a hard bounce flags the address and asks for a desk alert; texts are
 * edited and reset per property.
 */
describe("Guest messages", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let book: (lastName: string, email: string | null, language: string | null, arrivalIn?: number) => Promise<string>;
  const fd = "user_frida";
  const today = todayIn("Europe/Berlin");
  const s = () => tenant.schemaName;
  const mail = new FakeMailProvider();
  const sms = new FakeSmsProvider();
  const providers = { mail, sms };
  const options = { platformDomain: "mail.hoteloftware.test" };
  // 23:00 tonight in Berlin, and the same at noon
  const at = (time: string) => new Date(new Date(`${today}T${time}:00Z`).getTime() - offsetMinutes(new Date(`${today}T12:00:00Z`)) * 60000);
  const offsetMinutes = (d: Date) => {
    const local = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
    const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
    return (local.getTime() - utc.getTime()) / 60000;
  };

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "Haus am Ring GmbH", country: "DE", addressLine1: "Ring 1", postalCode: "10115", city: "Berlin", vatId: "DE123456789", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s(), { name: "Haus am Ring", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    const dbl = (await createRoomType(pool, s(), { propertyId, code: "DBL", name: "Double", maxOccupancy: 4, maxAdults: 2, bedPlaces: 2, extraBeds: 2 })).id;
    await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: Array.from({ length: 10 }, (_, i) => String(101 + i)) });
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const room = await createService(pool, s(), { propertyId, code: "ROOM", name: "Room", defaultPrice: 0, taxCodeId: codes.find((c) => c.code === "ACC")!.id, revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s(), { propertyId, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), propertyId, fd, Array.from({ length: 10 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price: 100 })));
    book = async (lastName, email, language, arrivalIn = 5) => {
      const g = (await createGuest(pool, s(), { firstName: "Aiko", lastName, email, language }, { userId: fd, propertyId })).id;
      return (await createBooking(pool, s(), propertyId, fd, { booker: { guestId: g }, walkIn: false, notes: "", reservations: [{ arrival: addDays(today, arrivalIn), departure: addDays(today, arrivalIn + 2), roomTypeId: dbl, ratePlanId: plan.id, adults: 2, childAges: [], primaryGuestId: g }] })).reservations[0]!.id;
    };
  });
  afterAll(() => pool.end());

  it("confirms a booking in the guest's language, with the hotel's look and legal footer", async () => {
    const id = await book("Tanaka", "Aiko@Example.com", "en");
    expect(await scanGuestMessages(pool, s(), at("12:00"))).toBe(1);
    // once only
    expect(await scanGuestMessages(pool, s(), at("12:01"))).toBe(0);
    await dispatchMessages(pool, s(), tenant.id, providers, options, at("12:01"));
    const sent = mail.sent.find((m) => m.to === "aiko@example.com")!;
    expect(sent.subject).toMatch(/^Your booking \d+ at Haus am Ring$/);
    expect(sent.html).toContain("Dear Aiko Tanaka,");
    expect(sent.html).toContain("Haus am Ring GmbH · Ring 1, 10115 Berlin · VAT DE123456789");
    expect(sent.html).toContain("#0071e3");
    // not verified: the platform domain carries the hotel's name
    expect(sent.from).toBe("no-reply@mail.hoteloftware.test");
    expect(sent.fromName).toBe("Haus am Ring");
    const [row] = await reservationMessages(pool, s(), id);
    expect(row).toMatchObject({ type: "confirmation", language: "en", status: "sent" });
    await recordMailEvent(pool, s(), { id: "ev-d1", type: "delivered", severity: null, tenantId: tenant.id, messageId: row!.id, recipient: "aiko@example.com", detail: "" });
    expect((await reservationMessages(pool, s(), id))[0]!.status).toBe("delivered");
  });

  it("holds a service message triggered at 23:00 until Sending Hours; one with a Portal Link waits for the portal", async () => {
    await setMessagingSettings(pool, s(), propertyId, { sendingFrom: "08:00", sendingTo: "20:00", fallbackLanguage: "de", useGuestLanguage: true, enabled: { welcome: true }, channelConfirmation: true, replyTo: null, preArrivalDays: 3, checkoutTime: "10:30" }, fd);
    const id = await book("Late", "late@example.com", "de", 0);
    const { rows } = await pool.query<{ id: string }>(`select id from ${s()}.rooms where property_id = $1 order by number limit 1`, [propertyId]);
    await assignRoom(pool, s(), id, fd, rows[0]!.id);
    await checkIn(pool, s(), id, fd, { notReadyReason: "test" });
    await scanGuestMessages(pool, s(), at("23:00"));
    const msgs = await reservationMessages(pool, s(), id);
    const welcome = msgs.find((m) => m.type === "welcome")!;
    const confirmation = msgs.find((m) => m.type === "confirmation")!;
    // the document goes at once, the service message the next morning at 08:00
    expect(confirmation.sendAfter.getTime()).toBe(at("23:00").getTime());
    expect(welcome.sendAfter.toISOString()).toBe(new Date(at("08:00").getTime() + 86400000).toISOString());
    expect(welcome.subject).toBe("Willkommen im Haus am Ring");
    // the pre-arrival invitation carries the Portal Link (ticket 40): not queued yet
    expect(msgs.find((m) => m.type === "pre_arrival")).toBeUndefined();
    mail.sent.length = 0;
    await dispatchMessages(pool, s(), tenant.id, providers, options, at("23:05"));
    expect(mail.sent.map((m) => m.subject)).not.toContain(welcome.subject);
    await dispatchMessages(pool, s(), tenant.id, providers, options, new Date(at("08:00").getTime() + 86400000));
    expect(mail.sent.map((m) => m.subject)).toContain(welcome.subject);
  });

  it("marks a hard-bounced address, asks for a desk alert, and sends no more to it", async () => {
    const id = await book("Bounce", "nobody@example.com", "en");
    await scanGuestMessages(pool, s(), at("12:00"));
    await dispatchMessages(pool, s(), tenant.id, providers, options, at("12:00"));
    const msg = (await reservationMessages(pool, s(), id))[0]!;
    const alert = await recordMailEvent(pool, s(), { id: "ev-b1", type: "failed", severity: "permanent", tenantId: tenant.id, messageId: msg.id, recipient: "nobody@example.com", detail: "No such user" });
    expect(alert).toMatchObject({ reservationId: id, propertyId, type: "confirmation" });
    // a replayed event does nothing
    expect(await recordMailEvent(pool, s(), { id: "ev-b1", type: "failed", severity: "permanent", tenantId: tenant.id, messageId: msg.id, recipient: "nobody@example.com", detail: "" })).toBeNull();
    expect((await reservationMessages(pool, s(), id))[0]).toMatchObject({ status: "failed", reason: "No such user" });
    await cancelReservation(pool, s(), id, fd);
    await scanGuestMessages(pool, s(), at("12:10"));
    expect((await reservationMessages(pool, s(), id)).find((m) => m.type === "cancellation")).toMatchObject({ status: "suppressed", reason: "bounced" });
  });

  it("keeps a guest without address on record, and leaves switched-off types out", async () => {
    await setMessagingSettings(pool, s(), propertyId, { sendingFrom: "08:00", sendingTo: "20:00", fallbackLanguage: "de", useGuestLanguage: true, enabled: { pre_arrival: false, welcome: false }, channelConfirmation: true, replyTo: null, preArrivalDays: 3, checkoutTime: "11:00" }, fd);
    expect((await messagingSettings(pool, s(), propertyId)).enabled).toMatchObject({ pre_arrival: false, confirmation: true, welcome: false });
    const id = await book("Nomail", null, "fr", 2);
    await scanGuestMessages(pool, s(), at("12:00"));
    const msgs = await reservationMessages(pool, s(), id);
    expect(msgs.map((m) => [m.type, m.status, m.reason, m.language])).toEqual([["confirmation", "suppressed", "no_email", "de"]]);
  });

  it("leaves our confirmation out for booking-site bookings when switched off, on record", async () => {
    await setMessagingSettings(pool, s(), propertyId, { sendingFrom: "08:00", sendingTo: "20:00", fallbackLanguage: "de", useGuestLanguage: true, enabled: {}, channelConfirmation: false, replyTo: null, preArrivalDays: 3, checkoutTime: "11:00" }, fd);
    const id = await book("Channel", "c@example.com", "en");
    await pool.query(`update ${s()}.bookings set source = 'channel', channel_name = 'Booking.com' where id = (select booking_id from ${s()}.reservations where id = $1)`, [id]);
    await scanGuestMessages(pool, s(), at("12:00"));
    expect((await reservationMessages(pool, s(), id)).map((m) => [m.type, m.status, m.reason])).toEqual([["confirmation", "suppressed", "channel"]]);
    await setMessagingSettings(pool, s(), propertyId, { sendingFrom: "08:00", sendingTo: "20:00", fallbackLanguage: "de", useGuestLanguage: true, enabled: {}, channelConfirmation: true, replyTo: null, preArrivalDays: 3, checkoutTime: "11:00" }, fd);
  });

  it("edits a text per language, refuses unknown placeholders, resets to the shipped text", async () => {
    await expect(setMessageText(pool, s(), propertyId, "confirmation", "en", { subject: "Hi {gast}", blocks: ["x"] }, fd)).rejects.toThrow(/\{gast\}/);
    // mandatory content stays
    await expect(setMessageText(pool, s(), propertyId, "confirmation", "en", { subject: "Booked", blocks: ["Hello {guest_name}!"] }, fd)).rejects.toThrow(/must keep \{confirmation\}, \{arrival\}, \{departure\}/);
    await setMessageText(pool, s(), propertyId, "confirmation", "en", { subject: "Booked: {confirmation}", blocks: ["Hello {guest_name}!", "", "{arrival} to {departure}"] }, fd);
    expect(await messageText(pool, s(), propertyId, "confirmation", "en")).toEqual({ subject: "Booked: {confirmation}", blocks: ["Hello {guest_name}!", "{arrival} to {departure}"], edited: true });
    expect((await messageText(pool, s(), propertyId, "confirmation", "de")).edited).toBe(false);
    await resetMessageText(pool, s(), propertyId, "confirmation", "en");
    expect((await messageText(pool, s(), propertyId, "confirmation", "en")).subject).toBe("Your booking {confirmation} at {hotel_name}");
  });

  it("refuses free mail, the platform's domain and another tenant's domain; sends from the hotel's domain once verified", async () => {
    const domain = (d: string, tenantId = tenant.id, schema = s()) => setSenderDomain(pool, schema, { tenantId, propertyId, domain: d, local: "booking", platformDomain: "mail.hoteloftware.test" }, fd);
    await expect(domain("gmx.de")).rejects.toThrow(/free-mail/);
    await expect(domain("hoteloftware.test")).rejects.toThrow(/platform/);
    await domain("haus-am-ring.invalid");
    expect(await checkSenderDomain(pool, s(), propertyId, mail)).toMatchObject({ verified: false });
    await domain("haus-am-ring.de");
    expect(await checkSenderDomain(pool, s(), propertyId, mail)).toMatchObject({ verified: true });
    const beta = await provisionTenant(pool, { slug: "beta", name: "Beta" }, tenantMigrations());
    await expect(domain("haus-am-ring.de", beta.id, beta.schemaName)).rejects.toThrow(/another account/);
    await book("Domain", "d@example.com", "en");
    await scanGuestMessages(pool, s(), at("12:00"));
    await dispatchMessages(pool, s(), tenant.id, providers, options, at("12:00"));
    const sent = mail.sent.find((m) => m.to === "d@example.com")!;
    expect(sent.from).toBe("booking@haus-am-ring.de");
    expect(sent.sendingDomain).toBe("haus-am-ring.de");
  });

  it("sends queued SMS alerts", async () => {
    await queueSms(pool, s(), { toUserId: "u_pm", toPhone: "+491701234567", body: "Night Audit overdue · Haus am Ring" });
    await dispatchMessages(pool, s(), tenant.id, providers, options);
    expect(sms.sent).toEqual([expect.objectContaining({ to: "+491701234567", text: "Night Audit overdue · Haus am Ring" })]);
  });
});
