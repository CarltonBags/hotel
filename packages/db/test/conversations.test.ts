import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn, type Actor } from "@hoteloftware/domain";
import { FakeScanner, LocalFileStore } from "@hoteloftware/storage";
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
import { portalKeys, PORTAL_USER } from "../src/tenant/portal";
import { FileRefused, storeFile } from "../src/tenant/files";
import { visibleFile } from "../src/tenant/maintenance";
import {
  claimConversation,
  conversationView,
  escalateConversations,
  listConversations,
  markConversationSeen,
  portalConversation,
  portalConversationFile,
  postGuestMessage,
  postStaffMessage,
  setInboxSettings,
  unreadConversations,
} from "../src/tenant/conversations";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: a guest writes in the portal, staff answer or note; unread clears
 * only when the latest guest message is opened; escalation counts Desk Hours
 * only; one automatic reply a night; attachments up to 10 MB both ways.
 */
describe("Guest Inbox and Conversations", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let key = "";
  let nightKey = "";
  let guestId = "";
  const fd = { userId: "user_frida", name: "Frida Desk" };
  const today = todayIn("Europe/Berlin");
  const links = { base: "https://alpha.example" };
  const s = () => tenant.schemaName;
  const files = { store: null as unknown as LocalFileStore, scanner: new FakeScanner() };
  const actor = (): Actor => ({ tenantRole: undefined, propertyRoles: [{ propertyId, role: "front_desk" }] });
  const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  const at = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    files.store = new LocalFileStore(await mkdtemp(join(tmpdir(), "hs-inbox-")));
    const le = (await createLegalEntity(pool, s(), { name: "A GmbH", country: "DE", addressLine1: "Ring 1", postalCode: "10115", city: "Berlin", vatId: "DE1", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s(), { name: "Haus am Ring", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    const dbl = (await createRoomType(pool, s(), { propertyId, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: ["101", "102", "103"] });
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s(), { propertyId, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), propertyId, fd.userId, Array.from({ length: 12 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n - 4), price: 100 })));
    guestId = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka", email: "aiko@example.com", language: "en" }, { userId: fd.userId, propertyId })).id;
    const book = async (from: number, to: number) => {
      const b = await createBooking(pool, s(), propertyId, fd.userId, { booker: { guestId }, walkIn: false, notes: "", reservations: [{ arrival: addDays(today, from), departure: addDays(today, to), roomTypeId: dbl, ratePlanId: plan.id, adults: 1, childAges: [], primaryGuestId: guestId, force: true }] });
      return (await portalKeys(pool, s(), b.reservations[0]!.id))!.reservation;
    };
    key = await book(2, 4);
    nightKey = await book(5, 7);
    // an earlier stay of the same guest, with its own Conversation
    const earlierKey = await book(0, 1);
    await pool.query(`update ${s()}.reservations set arrival = $2, departure = $3 where portal_key = $1`, [earlierKey, addDays(today, -3), addDays(today, -1)]);
    await setInboxSettings(pool, s(), propertyId, { deskOpens: "00:00", deskCloses: "00:00", emergencyPhone: "+49 30 123456", escalationMinutes: 15 }, fd.userId);
    await postGuestMessage(pool, s(), earlierKey, { body: "Is there parking?", fileId: null }, links);
  });
  afterAll(() => pool.end());

  it("unread clears only when a staff member opens the latest guest message", async () => {
    const first = await postGuestMessage(pool, s(), key, { body: "Can we arrive at 23:00?", fileId: null }, links);
    expect((await listConversations(pool, s(), propertyId)).find((c) => c.id === first.conversationId)).toMatchObject({ unread: true, guestName: "Aiko Tanaka" });
    const seen = (await conversationView(pool, s(), propertyId, first.conversationId))!;
    // a second message comes in while the first is on screen
    await postGuestMessage(pool, s(), key, { body: "And is breakfast included?", fileId: null }, links);
    await markConversationSeen(pool, s(), propertyId, first.conversationId, seen.latestGuestMessageId!);
    expect((await listConversations(pool, s(), propertyId)).find((c) => c.id === first.conversationId)?.unread).toBe(true);
    const now = (await conversationView(pool, s(), propertyId, first.conversationId))!;
    await markConversationSeen(pool, s(), propertyId, first.conversationId, now.latestGuestMessageId!);
    expect((await listConversations(pool, s(), propertyId)).find((c) => c.id === first.conversationId)?.unread).toBe(false);
    expect(await unreadConversations(pool, s(), [propertyId])).toBe(1);
  });

  it("staff answer by email with the Portal Link; an Internal Note stays with staff; earlier stays show read-only", async () => {
    const c = (await listConversations(pool, s(), propertyId)).find((x) => x.arrival === addDays(today, 2))!;
    await postStaffMessage(pool, s(), propertyId, c.id, fd, { body: "Yes, the night porter will let you in.", note: false, fileId: null }, links);
    await postStaffMessage(pool, s(), propertyId, c.id, fd, { body: "Guest sounded unsure about the date.", note: true, fileId: null }, links);
    const mail = (await pool.query(`select type, to_email, body_text from ${s()}.guest_messages where type = 'inbox_reply'`)).rows[0];
    expect(mail.to_email).toBe("aiko@example.com");
    expect(mail.body_text).toContain("night porter");
    expect(mail.body_text).toContain(`https://alpha.example/g/${key}`);
    const guestSees = (await portalConversation(pool, s(), key))!;
    expect(guestSees.map((m) => m.kind)).toEqual(["guest", "guest", "staff"]);
    const view = (await conversationView(pool, s(), propertyId, c.id))!;
    expect(view.messages.some((m) => m.kind === "note")).toBe(true);
    expect(view.conversation.waitingSince).toBeNull();
    expect(view.earlier).toHaveLength(1);
    expect(view.earlier[0]!.messages[0]!.body).toBe("Is there parking?");
    expect(view.values).toMatchObject({ firstName: "Aiko", property: "Haus am Ring" });
    await claimConversation(pool, s(), propertyId, c.id, fd);
    expect((await listConversations(pool, s(), propertyId)).find((x) => x.id === c.id)?.claimedName).toBe("Frida Desk");
  });

  it("escalates an unopened message after 15 minutes during Desk Hours, once", async () => {
    const p = await postGuestMessage(pool, s(), key, { body: "Hello?", fileId: null }, links);
    expect(await escalateConversations(pool, s(), later(10))).toEqual([]);
    // this one, and the earlier stay's message nobody opened either
    expect(await escalateConversations(pool, s(), later(16))).toContainEqual({ conversationId: p.conversationId, propertyId, guestName: "Aiko Tanaka" });
    expect(await escalateConversations(pool, s(), later(30))).toEqual([]);
  });

  it("outside Desk Hours: no escalation, the timer pauses; one automatic reply a night", async () => {
    // the desk opens in three hours, for an hour
    await setInboxSettings(pool, s(), propertyId, { deskOpens: at(hour + 3), deskCloses: at(hour + 4), emergencyPhone: "+49 30 123456", escalationMinutes: 15 }, fd.userId);
    const p = await postGuestMessage(pool, s(), nightKey, { body: "The heating is off", fileId: null }, links);
    expect(p.autoReplied).toBe(true);
    expect((await postGuestMessage(pool, s(), nightKey, { body: "Still cold", fileId: null }, links)).autoReplied).toBe(false);
    expect(await escalateConversations(pool, s(), later(60))).toEqual([]);
    const auto = (await portalConversation(pool, s(), nightKey))!.filter((m) => m.kind === "auto" && m.subject?.startsWith("Your message"));
    expect(auto).toHaveLength(1);
    expect(auto[0]!.body).toContain("+49 30 123456");
    // the desk opened: fifteen minutes later it goes to the Property Manager
    expect(await escalateConversations(pool, s(), later(3 * 60 + 16))).toHaveLength(1);
    await setInboxSettings(pool, s(), propertyId, { deskOpens: "00:00", deskCloses: "00:00", emergencyPhone: null, escalationMinutes: 15 }, fd.userId);
  });

  it("images and PDFs up to 10 MB both ways; the guest and staff open them", async () => {
    const pdf = (size: number) => {
      const b = new Uint8Array(size);
      b.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
      return b;
    };
    await expect(storeFile(pool, s(), files, { tenantId: tenant.id, kind: "conversation_file", bytes: pdf(10 * 1024 * 1024 + 1), contentType: "application/pdf", propertyId, userId: PORTAL_USER })).rejects.toThrow(FileRefused);
    const fileId = await storeFile(pool, s(), files, { tenantId: tenant.id, kind: "conversation_file", bytes: pdf(2000), contentType: "application/pdf", propertyId, userId: PORTAL_USER });
    await postGuestMessage(pool, s(), key, { body: "", fileId }, links);
    expect((await portalConversationFile(pool, s(), key, fileId))?.contentType).toBe("application/pdf");
    expect(await portalConversationFile(pool, s(), nightKey, fileId)).toBeNull();
    expect((await visibleFile(pool, s(), fileId, { userId: fd.userId, actor: actor() }))?.id).toBe(fileId);
    // a file is sent once, by who uploaded it
    await expect(postGuestMessage(pool, s(), key, { body: "again", fileId }, links)).rejects.toThrow(/attachment/);
  });
});
