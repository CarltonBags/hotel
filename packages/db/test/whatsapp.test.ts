import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn } from "@hoteloftware/domain";
import { FakeMailProvider, FakeSmsProvider, FakeWhatsAppProvider } from "@hoteloftware/messaging";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms } from "../src/tenant/rooms";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createBooking } from "../src/tenant/reservations";
import { dispatchMessages, sendGuestMessage, sendWhatsAppTemplate } from "../src/tenant/messages";
import { conversationOfReservation, linkUnassignedWhatsApp, listConversations, postStaffMessage, receiveWhatsApp } from "../src/tenant/conversations";
import { applyWhatsAppStatus, connectWhatsApp, deliverStaffWhatsApp, listUnassignedWhatsApp, refreshTemplateReviews, setWhatsAppConsent, whatsAppConsentOf, whatsAppUsage } from "../src/tenant/whatsapp";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: a property connects its number; templates go to review (an edit is
 * a new version); outside 24 hours only an approved template goes, free text
 * is refused; a guest stored with a national number is matched; an unknown
 * number waits Unassigned and is linked; withdrawal stops WhatsApp only, also
 * for a message queued before; Meta's billed messages are counted once.
 */
describe("WhatsApp Module", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let reservationId = "";
  let guestId = "";
  const fd = { userId: "user_frida", name: "Frida Desk" };
  const today = todayIn("Europe/Berlin");
  const links = { base: "https://alpha.example" };
  const s = () => tenant.schemaName;
  const wa = new FakeWhatsAppProvider("secret");
  const mail = new FakeMailProvider();
  const providers = { mail, sms: new FakeSmsProvider(), whatsapp: { provider: wa } };
  const read = async () => null;
  /** Messages wait for their send time of day: dispatched as at the end of today in Berlin, so the test does not depend on the hour it runs at. */
  /** A guest writing at night gets the out-of-hours answer by email: their messages here are written at midday. */
  const midday = () => new Date(`${today}T10:00:00Z`);
  const dayLater = () => new Date(Math.max(Date.now(), Date.parse(`${today}T21:59:00Z`)));

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "A GmbH", country: "DE", addressLine1: "Ring 1", postalCode: "10115", city: "Berlin", vatId: "DE1", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s(), { name: "Haus am Ring", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    const dbl = (await createRoomType(pool, s(), { propertyId, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: ["101"] });
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s(), { propertyId, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), propertyId, fd.userId, Array.from({ length: 6 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price: 100 })));
    guestId = (await createGuest(pool, s(), { firstName: "Mira", lastName: "Keller", email: "mira@example.com", phone: "0170 1234567", language: "en" }, { userId: fd.userId, propertyId })).id;
    const b = await createBooking(pool, s(), propertyId, fd.userId, { booker: { guestId }, walkIn: false, notes: "", reservations: [{ arrival: addDays(today, 2), departure: addDays(today, 4), roomTypeId: dbl, ratePlanId: plan.id, adults: 1, childAges: [], primaryGuestId: guestId }] });
    reservationId = b.reservations[0]!.id;
    await pool.query(`insert into ${s()}.property_modules (property_id, module, on_since, switched_on_by) values ($1, 'whatsapp', current_date - 1, 'test')`, [propertyId]);
    await connectWhatsApp(pool, s(), wa, { tenantId: tenant.id, propertyId, code: "code", wabaId: "test_waba", phoneNumberId: "test_pn", coexistence: true }, "user_pm");
    // nothing was sent while the confirmation went out: it is a document, and nobody opted in yet
    await pool.query(`update ${s()}.guest_messages set status = 'sent'`);
  });
  afterAll(() => pool.end());

  it("templates are submitted for review; an edit is a new version while the approved one goes out", async () => {
    const t = await pool.query(`select type, language, status from ${s()}.whatsapp_templates order by type, language`);
    expect(t.rows.length).toBe(10);
    expect(t.rows.every((r) => r.status === "in_review")).toBe(true);
    wa.review("approved");
    await refreshTemplateReviews(pool, s(), wa);
    expect((await pool.query(`select count(*)::int as n from ${s()}.whatsapp_templates where approved_name = name`)).rows[0].n).toBe(10);
  });

  it("outside the 24 hours free text is refused and an approved template goes; inside them free text", async () => {
    await setWhatsAppConsent(pool, s(), guestId, { granted: true, source: "pre-check-in", wording: "WhatsApp messages from the hotel" });
    const c = await conversationOfReservation(pool, s(), reservationId);
    const refused = await postStaffMessage(pool, s(), propertyId, c.id, fd, { body: "Hello?", note: false, fileId: null, seenUpTo: null, transport: "whatsapp" }, links);
    await expect(deliverStaffWhatsApp(pool, s(), wa, { propertyId, messageId: refused.messageId, read })).rejects.toThrow(/approved template or by email/);
    await sendWhatsAppTemplate(pool, s(), { propertyId, conversationId: c.id, type: "pre_arrival", links }, fd.userId);
    await dispatchMessages(pool, s(), tenant.id, providers, { platformDomain: "mail.test" }, dayLater());
    // the guest's number stored nationally ("0170…") is reached internationally
    expect(wa.sent.at(-1)).toMatchObject({ to: "491701234567", template: { name: "hs_pre_arrival", language: "en" } });
    // the guest writes (national number on the profile is matched): free text within 24 hours
    await receiveWhatsApp(pool, s(), { propertyId, providerId: "wamid.in1", from: "491701234567", name: "Mira", text: "Great,\nthanks!", at: new Date(), fileId: null }, links, midday());
    const free = await postStaffMessage(pool, s(), propertyId, c.id, fd, { body: "You're welcome.", note: false, fileId: null, seenUpTo: null, transport: "whatsapp" }, links);
    await deliverStaffWhatsApp(pool, s(), wa, { propertyId, messageId: free.messageId, read });
    expect(wa.sent.at(-1)).toMatchObject({ text: "You're welcome." });
    const thread = await pool.query(`select via, delivery from ${s()}.conversation_messages where conversation_id = $1 and kind <> 'guest' order by created_at`, [c.id]);
    expect(thread.rows.map((r) => `${r.via}:${r.delivery}`)).toEqual(["whatsapp:failed", "whatsapp:sent"]);
  });

  it("an unknown number lands Unassigned and can be linked to a reservation", async () => {
    expect(await receiveWhatsApp(pool, s(), { propertyId, providerId: "wamid.in2", from: "41791112233", name: "Unknown", text: "Is the sauna open?", at: new Date(), fileId: null }, links, midday())).toBeNull();
    const [u] = await listUnassignedWhatsApp(pool, s(), [propertyId]);
    expect(u).toMatchObject({ fromPhone: "41791112233", body: "Is the sauna open?" });
    const conversationId = await linkUnassignedWhatsApp(pool, s(), propertyId, u!.id, reservationId, { userId: fd.userId, actor: { tenantRole: undefined, propertyRoles: [{ propertyId, role: "front_desk" }] } }, links, midday());
    expect(await listUnassignedWhatsApp(pool, s(), [propertyId])).toHaveLength(0);
    expect((await listConversations(pool, s(), [propertyId])).find((c) => c.id === conversationId)?.lastText).toBe("Is the sauna open?");
  });

  it("withdrawal stops WhatsApp only, also for a message queued before; email continues", async () => {
    await sendGuestMessage(pool, s(), { reservationId, type: "card_request", links }, fd.userId);
    expect((await pool.query(`select transport from ${s()}.guest_messages where type = 'card_request' order by created_at desc limit 1`)).rows[0].transport).toBe("whatsapp");
    const mailsBefore = mail.sent.length;
    await receiveWhatsApp(pool, s(), { propertyId, providerId: "wamid.stop", from: "491701234567", name: "Mira", text: "Stopp", at: new Date(), fileId: null }, links, midday());
    expect(await whatsAppConsentOf(pool, s(), guestId)).toBe(false);
    await dispatchMessages(pool, s(), tenant.id, providers, { platformDomain: "mail.test" }, dayLater());
    await dispatchMessages(pool, s(), tenant.id, providers, { platformDomain: "mail.test" }, dayLater());
    expect((await pool.query(`select transport, status from ${s()}.guest_messages where type = 'card_request' order by created_at desc limit 1`)).rows[0]).toEqual({ transport: "email", status: "sent" });
    expect(mail.sent.length).toBe(mailsBefore + 1);
    // writing again does not opt back in: a withdrawal stands until the guest opts in again
    await receiveWhatsApp(pool, s(), { propertyId, providerId: "wamid.after", from: "491701234567", name: "Mira", text: "One more question", at: new Date(), fileId: null }, links, midday());
    expect(await whatsAppConsentOf(pool, s(), guestId)).toBe(false);
  });

  it("what Meta bills is counted once per message, per property and month", async () => {
    const sentId = wa.sent.find((x) => x.template)!.messageId;
    const status = { tenantId: tenant.id, providerId: sentId, error: null, billable: true, cost: 0.05 };
    await applyWhatsAppStatus(pool, s(), { ...status, status: "delivered" });
    await applyWhatsAppStatus(pool, s(), { ...status, status: "read" });
    // free text inside the window is not billed
    await applyWhatsAppStatus(pool, s(), { ...status, providerId: wa.sent.find((x) => x.text)!.messageId, status: "delivered", billable: false });
    expect(await whatsAppUsage(pool, tenant.id, propertyId, new Date().toISOString().slice(0, 7))).toBe(1);
    // states only move forward
    await applyWhatsAppStatus(pool, s(), { ...status, providerId: wa.sent.find((x) => x.text)!.messageId, status: "sent", billable: false });
    expect((await pool.query(`select delivery from ${s()}.conversation_messages where provider_id = $1`, [wa.sent.find((x) => x.text)!.messageId])).rows[0].delivery).toBe("delivered");
  });
});
