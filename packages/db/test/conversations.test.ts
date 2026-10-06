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
import { assignRoom } from "../src/tenant/reservation-changes";
import {
  claimConversation,
  conversationByReplyToken,
  deleteExpiredConversations,
  messageToTask,
  receiveGuestEmail,
  setConversationDisputed,
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
  const links = { base: "https://alpha.example", replyDomain: "replies.example" };
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
    await setInboxSettings(pool, s(), propertyId, { deskOpens: "00:00", deskCloses: "00:00", checkinTime: "15:00", conversationMonths: 12, emergencyPhone: "+49 30 123456", escalationMinutes: 15 }, fd.userId);
    await postGuestMessage(pool, s(), earlierKey, { body: "Is there parking?", fileId: null }, links);
  });
  afterAll(() => pool.end());

  it("unread clears only when a staff member opens the latest guest message", async () => {
    const first = await postGuestMessage(pool, s(), key, { body: "Can we arrive at 23:00?", fileId: null }, links);
    expect((await listConversations(pool, s(), [propertyId])).find((c) => c.id === first.conversationId)).toMatchObject({ unread: true, guestName: "Aiko Tanaka" });
    const seen = (await conversationView(pool, s(), propertyId, first.conversationId))!;
    // a second message comes in while the first is on screen
    await postGuestMessage(pool, s(), key, { body: "And is breakfast included?", fileId: null }, links);
    await markConversationSeen(pool, s(), propertyId, first.conversationId, seen.latestGuestMessageId!);
    expect((await listConversations(pool, s(), [propertyId])).find((c) => c.id === first.conversationId)?.unread).toBe(true);
    const now = (await conversationView(pool, s(), propertyId, first.conversationId))!;
    await markConversationSeen(pool, s(), propertyId, first.conversationId, now.latestGuestMessageId!);
    expect((await listConversations(pool, s(), [propertyId])).find((c) => c.id === first.conversationId)?.unread).toBe(false);
    expect(await unreadConversations(pool, s(), [propertyId])).toBe(1);
  });

  it("staff answer by email with the Portal Link; an Internal Note stays with staff; earlier stays show read-only", async () => {
    const c = (await listConversations(pool, s(), [propertyId])).find((x) => x.lastText === "And is breakfast included?")!;
    const onScreen = (await conversationView(pool, s(), propertyId, c.id))!;
    await postStaffMessage(pool, s(), propertyId, c.id, fd, { body: "Yes, the night porter will let you in.", note: false, fileId: null, seenUpTo: onScreen.latestGuestMessageId }, links);
    await postStaffMessage(pool, s(), propertyId, c.id, fd, { body: "Guest sounded unsure about the date.", note: true, fileId: null, seenUpTo: null }, links);
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
    expect(view.values).toMatchObject({ firstName: "Aiko", property: "Haus am Ring", checkInTime: "15:00" });
    await claimConversation(pool, s(), propertyId, c.id, fd);
    expect((await listConversations(pool, s(), [propertyId])).find((x) => x.id === c.id)?.claimedName).toBe("Frida Desk");
  });

  it("an answer clears only what was on screen: a guest message that came in meanwhile stays unread and waiting", async () => {
    const c = (await listConversations(pool, s(), [propertyId])).find((x) => x.arrival === addDays(today, 2))!;
    const onScreen = (await conversationView(pool, s(), propertyId, c.id))!;
    await postGuestMessage(pool, s(), key, { body: "One more thing", fileId: null }, links);
    await postStaffMessage(pool, s(), propertyId, c.id, fd, { body: "Noted.", note: false, fileId: null, seenUpTo: onScreen.latestGuestMessageId }, links);
    const after = (await listConversations(pool, s(), [propertyId])).find((x) => x.id === c.id)!;
    expect(after.unread).toBe(true);
    expect(after.waitingSince).not.toBeNull();
    const latest = (await conversationView(pool, s(), propertyId, c.id))!.latestGuestMessageId!;
    await markConversationSeen(pool, s(), propertyId, c.id, latest);
  });

  it("earlier stays come from this property only, and another property's staff cannot open the Conversation", async () => {
    const le = (await pool.query(`select legal_entity_id from ${s()}.properties where id = $1`, [propertyId])).rows[0].legal_entity_id;
    const other = (await createProperty(pool, s(), { name: "Haus am See", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    const c = (await listConversations(pool, s(), [propertyId])).find((x) => x.arrival === addDays(today, 2))!;
    expect(await conversationView(pool, s(), other, c.id)).toBeNull();
    await expect(postStaffMessage(pool, s(), other, c.id, fd, { body: "x", note: false, fileId: null, seenUpTo: null }, links)).rejects.toThrow(/not found/);
    // a Conversation of the same guest at the other hotel stays out of this one's earlier stays
    expect((await conversationView(pool, s(), propertyId, c.id))!.earlier).toHaveLength(1);
    await pool.query(`update ${s()}.conversations set property_id = $1 where reservation_id = (select id from ${s()}.reservations where arrival = $2)`, [other, addDays(today, -3)]);
    expect((await conversationView(pool, s(), propertyId, c.id))!.earlier).toHaveLength(0);
    await pool.query(`update ${s()}.conversations set property_id = $1 where property_id = $2`, [propertyId, other]);
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
    await setInboxSettings(pool, s(), propertyId, { deskOpens: at(hour + 3), deskCloses: at(hour + 4), checkinTime: "15:00", conversationMonths: 12, emergencyPhone: "+49 30 123456", escalationMinutes: 15 }, fd.userId);
    const p = await postGuestMessage(pool, s(), nightKey, { body: "The heating is off", fileId: null }, links);
    expect(p.autoReplied).toBe(true);
    expect((await postGuestMessage(pool, s(), nightKey, { body: "Still cold", fileId: null }, links)).autoReplied).toBe(false);
    expect(await escalateConversations(pool, s(), later(60))).toEqual([]);
    const auto = (await portalConversation(pool, s(), nightKey))!.filter((m) => m.kind === "auto" && m.subject?.startsWith("Your message"));
    expect(auto).toHaveLength(1);
    expect(auto[0]!.body).toContain("+49 30 123456");
    // the desk opened: fifteen minutes later it goes to the Property Manager
    expect(await escalateConversations(pool, s(), later(3 * 60 + 16))).toHaveLength(1);
    await setInboxSettings(pool, s(), propertyId, { deskOpens: "00:00", deskCloses: "00:00", checkinTime: "15:00", conversationMonths: 12, emergencyPhone: null, escalationMinutes: 15 }, fd.userId);
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

  it("guest messages carry the Conversation's reply address; an email reply with an image lands in the thread", async () => {
    const mail = (await pool.query(`select reply_to from ${s()}.guest_messages where type = 'inbox_reply' order by created_at desc limit 1`)).rows[0];
    expect(mail.reply_to).toMatch(/^alpha\.[0-9a-f]{32}@replies\.example$/);
    const token = mail.reply_to.split("@")[0].split(".")[1];
    const target = (await conversationByReplyToken(pool, s(), token))!;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const fileId = await storeFile(pool, s(), files, { tenantId: tenant.id, kind: "conversation_file", bytes: png, contentType: "image/png", propertyId, userId: PORTAL_USER });
    const got = await receiveGuestEmail(pool, s(), { providerId: "<m1@mail>", token, sender: "aiko@example.com", subject: "Re: New message", text: "Here is the photo of the stain.", autoReply: false, raw: { subject: "Re: New message" }, fileIds: [fileId], mime: null }, links);
    expect(got).toMatchObject({ conversationId: target.conversationId });
    const thread = (await conversationView(pool, s(), propertyId, target.conversationId))!.messages.filter((m) => m.kind === "guest");
    expect(thread.at(-1)).toMatchObject({ body: "Here is the photo of the stain.", fileId, byEmail: true });
    // the same mail delivered again is taken once
    expect(await receiveGuestEmail(pool, s(), { providerId: "<m1@mail>", token, sender: "aiko@example.com", subject: "Re", text: "again", autoReply: false, raw: {}, fileIds: [], mime: null }, links)).toBeNull();
  });

  it("an out-of-office reply is kept but not counted as a guest message", async () => {
    const token = (await pool.query(`select reply_token from ${s()}.conversations c join ${s()}.reservations r on r.id = c.reservation_id where r.portal_key = $1`, [key])).rows[0].reply_token;
    const before = (await conversationView(pool, s(), propertyId, (await conversationByReplyToken(pool, s(), token))!.conversationId))!.messages.length;
    expect(await receiveGuestEmail(pool, s(), { providerId: "<ooo@mail>", token, sender: "aiko@example.com", subject: "Out of Office: Re: New message", text: "I am away until Monday.", autoReply: true, raw: {}, fileIds: [], mime: null }, links)).toBeNull();
    expect((await conversationView(pool, s(), propertyId, (await conversationByReplyToken(pool, s(), token))!.conversationId))!.messages.length).toBe(before);
    expect((await pool.query(`select auto_reply from ${s()}.inbound_mails where provider_id = '<ooo@mail>'`)).rows[0].auto_reply).toBe(true);
  });

  it("a message becomes a Maintenance Issue for the guest's room, linked back", async () => {
    const reservationId = (await pool.query(`select id from ${s()}.reservations where portal_key = $1`, [key])).rows[0].id;
    await pool.query(`update ${s()}.properties set business_date = $2 where id = $1`, [propertyId, addDays(today, 2)]);
    const room = (await pool.query(`select id from ${s()}.rooms where number = '102'`)).rows[0].id;
    await assignRoom(pool, s(), reservationId, fd.userId, room);
    const c = (await listConversations(pool, s(), [propertyId])).find((x) => x.reservationId === reservationId)!;
    const msg = (await conversationView(pool, s(), propertyId, c.id))!.messages.find((m) => m.kind === "guest" && m.body === "Here is the photo of the stain.")!;
    const viewer = { userId: fd.userId, actor: actor() };
    const issueId = await messageToTask(pool, s(), propertyId, msg.id, "maintenance", viewer);
    const issue = (await pool.query(`select room_id, note, conversation_message_id from ${s()}.maintenance_issues where id = $1`, [issueId])).rows[0];
    expect(issue).toMatchObject({ room_id: room, conversation_message_id: msg.id });
    expect(issue.note).toContain("stain");
    expect(await messageToTask(pool, s(), propertyId, msg.id, "maintenance", viewer)).toBe(issueId);
    const taskId = await messageToTask(pool, s(), propertyId, msg.id, "housekeeping", viewer);
    expect((await pool.query(`select room_id, kind from ${s()}.housekeeping_tasks where id = $1`, [taskId])).rows[0]).toEqual({ room_id: room, kind: "clean" });
    expect((await conversationView(pool, s(), propertyId, c.id))!.messages.find((m) => m.id === msg.id)).toMatchObject({ issueId, taskId });
    // the task was done; another request opens it again and is linked on its own
    await pool.query(`update ${s()}.housekeeping_tasks set status = 'done' where id = $1`, [taskId]);
    const other = (await conversationView(pool, s(), propertyId, c.id))!.messages.find((m) => m.kind === "guest" && m.id !== msg.id)!;
    expect(await messageToTask(pool, s(), propertyId, other.id, "housekeeping", viewer)).toBe(taskId);
    expect((await pool.query(`select status from ${s()}.housekeeping_tasks where id = $1`, [taskId])).rows[0].status).toBe("open");
    expect((await conversationView(pool, s(), propertyId, c.id))!.messages.find((m) => m.id === other.id)?.taskId).toBe(taskId);
  });

  it("retention deletes a Conversation 13 months after the stay and keeps a disputed one", async () => {
    const all = await listConversations(pool, s(), [propertyId]);
    const [old, disputed] = [all[0]!, all[1]!];
    for (const c of [old, disputed]) await pool.query(`update ${s()}.reservations set arrival = $2::date - interval '13 months' - interval '2 days', departure = $2::date - interval '13 months' where id = $1`, [c.reservationId, today]);
    await setConversationDisputed(pool, s(), propertyId, disputed.id, true, fd.userId);
    expect(await deleteExpiredConversations(pool, s(), today)).toBe(1);
    const left = (await listConversations(pool, s(), [propertyId])).map((c) => c.id);
    expect(left).not.toContain(old.id);
    expect(left).toContain(disputed.id);
  });
});
