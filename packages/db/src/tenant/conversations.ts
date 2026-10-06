import type { Pool, PoolClient } from "pg";
import { DEFAULT_MINUTES, can, conversationExpired, deskMinutesBetween, deskNight, isMessageLanguage, messageLanguage, portalLinkOpen, todayIn, type DeskHours, type MessageLanguage, type QuickReplyValues } from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { fileIn, setFileRetention, type StoredFile } from "./files";
import { ENSURE_MESSAGING, dateText, enabledTypes, queueGuestMessageIn, type PortalLinks } from "./messages";
import { reportIssueIn } from "./maintenance";
import { PORTAL_USER, reservationByKey } from "./portal";
import type { Viewer } from "./room-state";
import { withTenant } from "./with-tenant";

/**
 * Guest Inbox and Conversations (ticket 42): one Conversation per
 * Reservation, per Booking for the Booker of several rooms. Guests write in
 * the Guest Portal; staff answer (the guest is emailed with the Portal Link)
 * or leave Internal Notes; the automatic messages of the stay show in the
 * thread. Unread until a staff member opens the latest guest message; an
 * unopened one goes to the Property Manager after the property's time, counted
 * in Desk Hours only; outside them the guest gets one automatic reply a night.
 */

export interface ConversationOwner {
  reservationId: string | null;
  bookingId: string | null;
  propertyId: string;
}

interface ConversationRow {
  id: string;
  property_id: string;
  reservation_id: string | null;
  booking_id: string | null;
  desk_closed_night: string | null;
}

const ROW = "id, property_id, reservation_id, booking_id, to_char(desk_closed_night, 'YYYY-MM-DD') as desk_closed_night";
/** The column a Conversation is found by: its stay, or the Booker's booking. */
const ownerColumn = (owner: ConversationOwner) => (owner.reservationId ? "reservation_id" : "booking_id");
const ownerId = (owner: ConversationOwner) => owner.reservationId ?? owner.bookingId;
/** The guest a Conversation is with, as named: the stay's guest now (a changed guest counts), or the Booker. */
const GUEST_NAME = "coalesce(nullif(trim(g.first_name || ' ' || g.last_name), ''), co.name, '')";

/** The Conversation of a stay or booking, made on first use; locked for a change. */
async function conversationIn(tx: PoolClient, owner: ConversationOwner): Promise<ConversationRow> {
  await tx.query("insert into conversations (property_id, reservation_id, booking_id) values ($1, $2, $3) on conflict do nothing", [owner.propertyId, owner.reservationId, owner.bookingId]);
  const { rows } = await tx.query<ConversationRow>(`select ${ROW} from conversations where ${ownerColumn(owner)} = $1 for update`, [ownerId(owner)]);
  return rows[0]!;
}

/** A Conversation of the property, locked; another property's is simply not found. */
async function lockConversation(tx: PoolClient, id: string, propertyId: string): Promise<ConversationRow> {
  if (!isUuid(id)) throw new Error("Conversation not found");
  const { rows } = await tx.query<ConversationRow>(
    `select ${ROW} from conversations where id = $1 and property_id = $2 for update`,
    [id, propertyId],
  );
  if (!rows[0]) throw new Error("Conversation not found");
  return rows[0];
}

/** What a Portal Link opens: the stay, or the booking (the Booker's link); null when it opens nothing. */
async function ownerByKey(tx: PoolClient, key: string): Promise<(ConversationOwner & { key: string }) | null> {
  try {
    const r = await reservationByKey(tx, key);
    return { reservationId: r.id, bookingId: null, propertyId: r.property_id, key };
  } catch {
    // not a stay's link: perhaps the Booker's
  }
  const { rows } = await tx.query<{ id: string; property_id: string; departure: string | null; time_zone: string }>(
    `select b.id, b.property_id, p.time_zone,
            to_char((select max(departure) from reservations r where r.booking_id = b.id and r.status <> 'cancelled'), 'YYYY-MM-DD') as departure
     from bookings b join properties p on p.id = b.property_id where b.portal_key = $1`,
    [key],
  );
  const b = rows[0];
  if (!b?.departure || !portalLinkOpen(b.departure, todayIn(b.time_zone))) return null;
  return { reservationId: null, bookingId: b.id, propertyId: b.property_id, key };
}

/**
 * Before a guest's message or upload is stored: the link opens a stay or
 * booking and its Conversation is below the hourly limit. Uploads that never
 * made it into a message are limited per property, so a link cannot fill the
 * storage. The property the files belong to.
 */
export async function guestMayWrite(pool: Pool, schema: string, key: string, withFile: boolean): Promise<{ propertyId: string }> {
  return withTenant(pool, schema, async (tx) => {
    const owner = await ownerByKey(tx, key);
    if (!owner) throw new Error("This link does not open anything");
    await assertGuestPace(tx, owner);
    if (withFile) {
      const { rows } = await tx.query<{ n: string }>(
        `select count(*) as n from stored_files f where f.kind = 'conversation_file' and f.created_by = $1 and f.property_id = $2 and f.created_at > now() - interval '1 hour'
           and not exists (select 1 from conversation_messages m where m.file_id = f.id)`,
        [PORTAL_USER, owner.propertyId],
      );
      if (Number(rows[0]!.n) >= UNSENT_UPLOADS_PER_HOUR) throw new Error("Files cannot be added just now; please try again later");
    }
    return { propertyId: owner.propertyId };
  });
}

const GUEST_MESSAGES_PER_HOUR = 30;
const UNSENT_UPLOADS_PER_HOUR = 100;

/** The link is the only authority: a flood from it stops. */
async function assertGuestPace(tx: PoolClient, owner: ConversationOwner): Promise<void> {
  const { rows } = await tx.query<{ n: string }>(
    `select count(*) as n from conversation_messages m join conversations c on c.id = m.conversation_id where c.${ownerColumn(owner)} = $1 and m.kind = 'guest' and m.created_at > now() - interval '1 hour'`,
    [ownerId(owner)],
  );
  if (Number(rows[0]!.n) >= GUEST_MESSAGES_PER_HOUR) throw new Error("Too many messages in a short time; please wait a little");
}

/** The staff's own Conversation of a reservation (to start one from the reservation). */
export async function conversationOfReservation(pool: Pool, schema: string, reservationId: string): Promise<{ id: string; propertyId: string }> {
  if (!isUuid(reservationId)) throw new Error("Reservation not found");
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ property_id: string }>("select property_id from reservations where id = $1", [reservationId]);
    if (!rows[0]) throw new Error("Reservation not found");
    const c = await conversationIn(tx, { reservationId, bookingId: null, propertyId: rows[0].property_id });
    return { id: c.id, propertyId: c.property_id };
  });
}

/** An uploaded file a message may carry: a Conversation file the sender uploaded, not yet in a message. Kept from now on. */
async function attachIn(tx: PoolClient, fileId: string | null, uploadedBy: string): Promise<string | null> {
  if (!fileId) return null;
  const f = isUuid(fileId) ? await fileIn(tx, fileId) : null;
  const used = f ? (await tx.query("select 1 from conversation_messages where file_id = $1", [fileId])).rows.length > 0 : true;
  if (!f || f.kind !== "conversation_file" || f.createdBy !== uploadedBy || used) throw new Error("The attachment was not found; please add it again");
  // deleted with the Conversation (retention comes with ticket 43)
  await setFileRetention(tx, [fileId], null);
  return fileId;
}

interface MessagingFacts {
  time_zone: string;
  desk_opens: string;
  desk_closes: string;
  switched: Record<string, boolean>;
}

async function factsIn(tx: PoolClient, propertyId: string): Promise<MessagingFacts> {
  await tx.query(ENSURE_MESSAGING, [propertyId]);
  return (await tx.query<MessagingFacts>(
    "select p.time_zone, to_char(m.desk_opens, 'HH24:MI') as desk_opens, to_char(m.desk_closes, 'HH24:MI') as desk_closes, m.switched from property_messaging m join properties p on p.id = m.property_id where m.property_id = $1",
    [propertyId],
  )).rows[0]!;
}

/** Where a guest message by email goes: the stay's guest with the stay's link; for a booking the Booker (greeted by name) with the booking's link. */
async function recipientIn(tx: PoolClient, c: ConversationRow): Promise<{ reservationId: string; toEmail?: string; greetName?: string; linkKey: string } | null> {
  if (c.reservation_id) {
    const { rows } = await tx.query<{ portal_key: string }>("select portal_key from reservations where id = $1", [c.reservation_id]);
    return { reservationId: c.reservation_id, linkKey: rows[0]!.portal_key };
  }
  const { rows } = await tx.query<{ reservation_id: string | null; email: string | null; name: string; portal_key: string }>(
    `select (select r.id from reservations r where r.booking_id = b.id and r.status <> 'cancelled' order by r.created_at limit 1) as reservation_id,
            nullif(trim(g.email), '') as email, trim(g.first_name || ' ' || g.last_name) as name, b.portal_key
     from bookings b left join guests g on g.id = b.booker_guest_id where b.id = $1`,
    [c.booking_id],
  );
  const b = rows[0];
  if (!b?.reservation_id || !b.email) return null;
  return { reservationId: b.reservation_id, toEmail: b.email, greetName: b.name, linkKey: b.portal_key };
}

const toOf = (c: ConversationRow, to: { toEmail?: string; greetName?: string; linkKey: string }) => ({
  conversationId: c.id,
  linkKey: to.linkKey,
  ...(to.toEmail ? { toEmail: to.toEmail } : {}),
  ...(to.greetName ? { greetName: to.greetName } : {}),
});

export interface GuestPost {
  conversationId: string;
  propertyId: string;
  messageId: string;
  guestName: string;
  /** Outside Desk Hours, the night's automatic reply went now. */
  autoReplied: boolean;
}

/** A guest writes in the Guest Portal (text, an image or a PDF). */
export async function postGuestMessage(pool: Pool, schema: string, key: string, input: { body: string; fileId: string | null }, links: PortalLinks | null, now = new Date()): Promise<GuestPost> {
  const body = input.body.trim().slice(0, 5000);
  if (!body && !input.fileId) throw new Error("Write a message or add a file");
  return withTenant(pool, schema, async (tx) => {
    const owner = await ownerByKey(tx, key);
    if (!owner) throw new Error("This link does not open anything");
    await assertGuestPace(tx, owner);
    const c = await conversationIn(tx, owner);
    const fileId = await attachIn(tx, input.fileId, PORTAL_USER);
    const posted = await guestMessagesIn(tx, c, { body, fileIds: fileId ? [fileId] : [], via: "portal" }, links, now);
    return { conversationId: c.id, propertyId: c.property_id, ...posted };
  });
}

/**
 * The guest's message(s) in the thread, from the portal or by email (one per
 * attachment past the first): waiting and unread from the first; outside Desk
 * Hours one automatic reply a night, where the property has it on.
 */
async function guestMessagesIn(
  tx: PoolClient,
  c: ConversationRow,
  input: { body: string; fileIds: string[]; via: "portal" | "email" },
  links: PortalLinks | null,
  now: Date,
): Promise<{ messageId: string; guestName: string; autoReplied: boolean }> {
  const { rows: who } = await tx.query<{ name: string }>(
    `select ${GUEST_NAME} as name from bookings b left join reservations r on r.id = $1 left join guests g on g.id = coalesce(r.primary_guest_id, b.booker_guest_id)
     left join companies co on co.id = b.booker_company_id where b.id = coalesce($2, r.booking_id)`,
    [c.reservation_id, c.booking_id],
  );
  const guestName = who[0]?.name ?? "";
  const parts = input.fileIds.length ? input.fileIds.map((fileId, i) => ({ body: i === 0 ? input.body : "", fileId })) : [{ body: input.body, fileId: null }];
  let first = "";
  for (const part of parts) {
    const { rows } = await tx.query<{ id: string }>(
      "insert into conversation_messages (conversation_id, kind, user_id, author_name, body, file_id, via) values ($1, 'guest', $2, $3, $4, $5, $6) returning id",
      [c.id, PORTAL_USER, guestName, part.body, part.fileId, input.via],
    );
    first ||= rows[0]!.id;
    // times as stored, never through the app's milliseconds
    await tx.query(
      `update conversations c set last_message_at = m.created_at, last_guest_message_at = m.created_at, waiting_since = coalesce(c.waiting_since, m.created_at),
         escalated_at = case when c.unread_since is null then null else c.escalated_at end, unread_since = coalesce(c.unread_since, m.created_at)
       from conversation_messages m where m.id = $2 and c.id = $1`,
      [c.id, rows[0]!.id],
    );
  }
  const facts = await factsIn(tx, c.property_id);
  const night = deskNight(now, { opens: facts.desk_opens, closes: facts.desk_closes }, facts.time_zone);
  let autoReplied = false;
  if (night && c.desk_closed_night !== night && enabledTypes(facts.switched).desk_closed) {
    const to = await recipientIn(tx, c);
    if (to) {
      await queueGuestMessageIn(tx, { reservationId: to.reservationId, type: "desk_closed", triggerKey: `${c.id}:${night}`, now, links, ...toOf(c, to) });
      await tx.query("update conversations set desk_closed_night = $2 where id = $1", [c.id, night]);
      autoReplied = true;
    }
  }
  return { messageId: first, guestName, autoReplied };
}

/** Replies count while the stay's Portal Link would open (until 30 days after departure). */
async function replyWindowOpen(tx: PoolClient, c: ConversationRow): Promise<boolean> {
  const { rows } = await tx.query<{ departure: string | null; time_zone: string }>(
    `select to_char(coalesce(r.departure, (select max(x.departure) from reservations x where x.booking_id = c.booking_id)), 'YYYY-MM-DD') as departure, p.time_zone
     from conversations c left join reservations r on r.id = c.reservation_id join properties p on p.id = c.property_id where c.id = $1`,
    [c.id],
  );
  return !!rows[0]?.departure && portalLinkOpen(rows[0].departure, todayIn(rows[0].time_zone));
}

/** Where an email reply goes: the Conversation of its reply address (null when the token is not ours). */
export async function conversationByReplyToken(pool: Pool, schema: string, token: string): Promise<{ conversationId: string; propertyId: string } | null> {
  if (!/^[0-9a-f]{20,64}$/.test(token)) return null;
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; property_id: string }>("select id, property_id from conversations where reply_token = $1", [token]);
    return rows[0] ? { conversationId: rows[0].id, propertyId: rows[0].property_id } : null;
  });
}

export interface InboundGuestMail {
  /** The provider's id of the mail: each is taken once. */
  providerId: string;
  token: string | null;
  sender: string;
  subject: string;
  /** The reply as written, quoted history stripped by the provider. */
  text: string;
  autoReply: boolean;
  /** Everything the provider told us, kept as received. */
  raw: unknown;
  /** Attachments already checked and stored (images and PDFs up to 10 MB). */
  fileIds: string[];
  /** The mail as sent, when the provider gave it. */
  mime: Uint8Array | null;
}

/** Whether a mail was taken before (a notice delivered again), so its attachments are not fetched twice. */
export async function inboundMailKnown(pool: Pool, schema: string, providerId: string): Promise<boolean> {
  return withTenant(pool, schema, async (tx) => (await tx.query("select 1 from inbound_mails where provider_id = $1", [providerId])).rows.length > 0);
}

/**
 * A guest's email reply (ticket 43): kept as received; unless it is an
 * automatic reply (out of office), its text and attachments land in the
 * Conversation as the guest's message, as if written in the portal. Null when
 * the mail was taken before or found no Conversation.
 */
export async function receiveGuestEmail(pool: Pool, schema: string, mail: InboundGuestMail, links: PortalLinks | null, now = new Date()): Promise<(GuestPost & { conversationId: string }) | null> {
  return withTenant(pool, schema, async (tx) => {
    const c = mail.token ? (await tx.query<ConversationRow>(`select ${ROW} from conversations where reply_token = $1 for update`, [mail.token])).rows[0] : undefined;
    const { rows: kept } = await tx.query(
      "insert into inbound_mails (provider_id, conversation_id, sender, subject, auto_reply, raw, mime) values ($1, $2, $3, $4, $5, $6, $7) on conflict (provider_id) do nothing returning id",
      [mail.providerId, c?.id ?? null, mail.sender.slice(0, 500), mail.subject.slice(0, 500), mail.autoReply, JSON.stringify(mail.raw), mail.mime ? Buffer.from(mail.mime) : null],
    );
    if (!kept.length || !c || mail.autoReply) return null;
    // the same guards as the portal: the link's window and the hourly limit (kept above, not posted)
    if (!(await replyWindowOpen(tx, c))) return null;
    try {
      await assertGuestPace(tx, { reservationId: c.reservation_id, bookingId: c.booking_id, propertyId: c.property_id });
    } catch {
      return null;
    }
    const body = mail.text.trim().slice(0, 5000);
    const fileIds = [];
    for (const f of mail.fileIds) fileIds.push((await attachIn(tx, f, PORTAL_USER))!);
    if (!body && !fileIds.length) return null;
    const posted = await guestMessagesIn(tx, c, { body, fileIds, via: "email" }, links, now);
    return { conversationId: c.id, propertyId: c.property_id, ...posted };
  });
}

/** A staff member answers (the guest is emailed with the Portal Link) or leaves an Internal Note the guest never sees. */
export async function postStaffMessage(
  pool: Pool,
  schema: string,
  propertyId: string,
  conversationId: string,
  author: { userId: string; name: string },
  input: { body: string; note: boolean; fileId: string | null; seenUpTo: string | null },
  links: PortalLinks | null,
  now = new Date(),
): Promise<{ messageId: string }> {
  const body = input.body.trim().slice(0, 5000);
  if (!body && !input.fileId) throw new Error("Write a message or add a file");
  return withTenant(pool, schema, async (tx) => {
    const c = await lockConversation(tx, conversationId, propertyId);
    const fileId = await attachIn(tx, input.fileId, author.userId);
    const { rows } = await tx.query<{ id: string }>(
      "insert into conversation_messages (conversation_id, kind, user_id, author_name, body, file_id) values ($1, $2, $3, $4, $5, $6) returning id",
      [c.id, input.note ? "note" : "staff", author.userId, author.name, body, fileId],
    );
    if (!input.note) {
      // answered: no longer waiting for what was on screen; a guest message that came in meanwhile stays waiting and unread
      await tx.query(
        `update conversations c set last_message_at = m.created_at,
           waiting_since = (select min(n.created_at) from conversation_messages n where n.conversation_id = c.id and n.kind = 'guest' and n.created_at > coalesce(s.created_at, '-infinity'))
         from conversation_messages m left join conversation_messages s on s.id = $3 and s.conversation_id = $1 and s.kind = 'guest'
         where m.id = $2 and c.id = $1`,
        [c.id, rows[0]!.id, input.seenUpTo && isUuid(input.seenUpTo) ? input.seenUpTo : null],
      );
      if (input.seenUpTo) await seenIn(tx, c.id, input.seenUpTo);
      const to = await recipientIn(tx, c);
      if (to) {
        const message = [body, fileId ? "(+ 1 attachment)" : ""].filter(Boolean).join(" ");
        await queueGuestMessageIn(tx, { reservationId: to.reservationId, type: "inbox_reply", triggerKey: rows[0]!.id, userId: author.userId, now, links, message, ...toOf(c, to) });
      }
    }
    return { messageId: rows[0]!.id };
  });
}

/**
 * Opened up to a guest message: what came after it stays unread (and keeps
 * its escalation). Under the Conversation's lock, so a guest message written
 * at the same moment is counted. Whether anything changed.
 */
async function seenIn(tx: PoolClient, conversationId: string, upToMessageId: string): Promise<boolean> {
  if (!isUuid(upToMessageId)) return false;
  const { rowCount } = await tx.query(
    `update conversations c set seen_until = greatest(coalesce(c.seen_until, m.created_at), m.created_at),
       unread_since = (select min(n.created_at) from conversation_messages n where n.conversation_id = c.id and n.kind = 'guest' and n.created_at > m.created_at),
       escalated_at = case when exists (select 1 from conversation_messages n where n.conversation_id = c.id and n.kind = 'guest' and n.created_at > m.created_at) then c.escalated_at end
     from conversation_messages m where m.id = $2 and m.conversation_id = c.id and m.kind = 'guest' and c.id = $1 and c.unread_since is not null and c.unread_since <= m.created_at`,
    [conversationId, upToMessageId],
  );
  return (rowCount ?? 0) > 0;
}

/** A staff member opened the Conversation up to a guest message: unread clears only when that is the latest one. Whether anything changed. */
export async function markConversationSeen(pool: Pool, schema: string, propertyId: string, conversationId: string, upToMessageId: string): Promise<boolean> {
  if (!isUuid(conversationId) || !isUuid(upToMessageId)) return false;
  return withTenant(pool, schema, async (tx) => {
    // the lock first, then a fresh statement: a guest message committed meanwhile is seen by it
    await lockConversation(tx, conversationId, propertyId);
    return seenIn(tx, conversationId, upToMessageId);
  });
}

/** "Handled by": a staff member claims the Conversation, or lets it go (null); others still see it and may answer. */
export async function claimConversation(pool: Pool, schema: string, propertyId: string, conversationId: string, user: { userId: string; name: string } | null): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const c = await lockConversation(tx, conversationId, propertyId);
    await tx.query("update conversations set claimed_by = $2, claimed_name = $3, claimed_at = case when $2::text is null then null else now() end where id = $1", [c.id, user?.userId ?? null, user?.name ?? null]);
  });
}

export interface ConversationListRow {
  id: string;
  propertyId: string;
  /** With several properties in view the hotel is named. */
  propertyName: string;
  /** Kept past its retention for a dispute. */
  disputed: boolean;
  reservationId: string | null;
  bookingId: string | null;
  guestName: string;
  confirmationNumber: string;
  arrival: string;
  departure: string;
  room: string | null;
  unread: boolean;
  waitingSince: Date | null;
  claimedBy: string | null;
  claimedName: string | null;
  lastMessageAt: Date | null;
  lastText: string;
}

const LIST_COLUMNS = `c.id, c.property_id, (select p.name from properties p where p.id = c.property_id) as property_name, c.disputed_at, c.reservation_id, c.booking_id, c.unread_since, c.waiting_since, c.claimed_by, c.claimed_name, c.last_message_at,
  ${GUEST_NAME} as guest_name, b.confirmation_number, coalesce(r.primary_guest_id, b.booker_guest_id) as guest_id,
  to_char(coalesce(r.arrival, (select min(x.arrival) from reservations x where x.booking_id = c.booking_id)), 'YYYY-MM-DD') as arrival,
  to_char(coalesce(r.departure, (select max(x.departure) from reservations x where x.booking_id = c.booking_id)), 'YYYY-MM-DD') as departure,
  (select rm.number from room_assignments a join rooms rm on rm.id = a.room_id where a.reservation_id = r.id order by a.from_date desc limit 1) as room,
  coalesce((select m.body from conversation_messages m where m.conversation_id = c.id and m.kind <> 'note' order by m.created_at desc limit 1), '') as last_text`;
const LIST_FROM = `conversations c left join reservations r on r.id = c.reservation_id
  join bookings b on b.id = coalesce(c.booking_id, r.booking_id)
  left join guests g on g.id = coalesce(r.primary_guest_id, b.booker_guest_id) left join companies co on co.id = b.booker_company_id`;

type ListRow = { id: string; guest_id: string | null; property_id: string; property_name: string; disputed_at: Date | null; reservation_id: string | null; booking_id: string | null; unread_since: Date | null; waiting_since: Date | null; claimed_by: string | null; claimed_name: string | null; last_message_at: Date | null; guest_name: string; confirmation_number: string; arrival: string; departure: string; room: string | null; last_text: string };
const toListRow = (r: ListRow): ConversationListRow => ({
  id: r.id,
  propertyId: r.property_id,
  propertyName: r.property_name,
  disputed: r.disputed_at !== null,
  reservationId: r.reservation_id,
  bookingId: r.booking_id,
  guestName: r.guest_name,
  confirmationNumber: r.confirmation_number,
  arrival: r.arrival,
  departure: r.departure,
  room: r.room,
  unread: r.unread_since !== null,
  waitingSince: r.waiting_since,
  claimedBy: r.claimed_by,
  claimedName: r.claimed_name,
  lastMessageAt: r.last_message_at,
  lastText: r.last_text.slice(0, 140),
});

/** The Guest Inbox of a property, or combined over several (ticket 43): unread first, then the newest; Conversations with a message only. */
export async function listConversations(pool: Pool, schema: string, propertyIds: string[]): Promise<ConversationListRow[]> {
  const ids = propertyIds.filter(isUuid);
  if (!ids.length) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<ListRow>(`select ${LIST_COLUMNS} from ${LIST_FROM} where c.property_id = any($1::uuid[]) and c.last_message_at is not null order by (c.unread_since is null), c.last_message_at desc limit 300`, [ids])).rows.map(toListRow),
  );
}

/** The property a Conversation belongs to, among those given (the combined inbox opens it at its own property). */
export async function conversationProperty(pool: Pool, schema: string, conversationId: string, propertyIds: string[]): Promise<string | null> {
  if (!isUuid(conversationId)) return null;
  return withTenant(pool, schema, async (tx) => (await tx.query<{ property_id: string }>("select property_id from conversations where id = $1 and property_id = any($2::uuid[])", [conversationId, propertyIds.filter(isUuid)])).rows[0]?.property_id ?? null);
}

/** Unread Conversations at the properties (the navbar badge). */
export async function unreadConversations(pool: Pool, schema: string, propertyIds: string[]): Promise<number> {
  const ids = propertyIds.filter(isUuid);
  if (!ids.length) return 0;
  return withTenant(pool, schema, async (tx) => Number((await tx.query<{ n: string }>("select count(*) as n from conversations where property_id = any($1::uuid[]) and unread_since is not null", [ids])).rows[0]!.n));
}

export interface ThreadMessage {
  id: string;
  kind: "guest" | "staff" | "note" | "auto";
  authorName: string;
  body: string;
  subject: string | null;
  fileId: string | null;
  fileType: string | null;
  at: Date;
  /** An automatic message not sent (no address, bounced, failed): staff see it marked. */
  notSent: boolean;
  /** A guest's message replied by email rather than written in the portal. */
  byEmail: boolean;
  /** Work made from it (ticket 43), linked back. */
  issueId: string | null;
  taskId: string | null;
}

interface ThreadOwner {
  id: string;
  reservation_id: string | null;
  booking_id: string | null;
}

/**
 * The thread: guest and staff messages, Internal Notes (staff only) and the
 * automatic messages, oldest first. Automatic: the Conversation's own (the
 * night's reply), and the stay's messages to its guest, or for a booking the
 * Booker's. The guest sees only what was sent (or kept for the portal).
 */
async function threadIn(tx: PoolClient, c: ThreadOwner, forStaff: boolean): Promise<ThreadMessage[]> {
  const { rows } = await tx.query<{ id: string; kind: ThreadMessage["kind"]; author_name: string; body: string; subject: string | null; file_id: string | null; file_type: string | null; at: Date; not_sent: boolean; by_email: boolean; issue_id: string | null; task_id: string | null }>(
    `select m.id, m.kind, m.author_name, m.body, null as subject, m.file_id, f.content_type as file_type, m.created_at as at, false as not_sent, m.via = 'email' as by_email,
            (select i.id from maintenance_issues i where i.conversation_message_id = m.id limit 1) as issue_id, (select tm.task_id from housekeeping_task_messages tm where tm.message_id = m.id) as task_id
     from conversation_messages m left join stored_files f on f.id = m.file_id where m.conversation_id = $1 and ($4 or m.kind <> 'note')
     union all
     select gm.id, 'auto', '', gm.body_text, gm.subject, null, null, gm.send_after, gm.status in ('failed', 'suppressed'), false, null, null
     from guest_messages gm
     where gm.type <> 'inbox_reply' and gm.send_after <= now()
       and (gm.conversation_id = $1
            or (gm.conversation_id is null and gm.reservation_id = $2)
            or (gm.conversation_id is null and $3::uuid is not null and gm.reservation_id in (select x.id from reservations x where x.booking_id = $3)
                and lower(gm.to_email) = (select lower(trim(g.email)) from bookings b join guests g on g.id = b.booker_guest_id where b.id = $3)))
       and ($4 or gm.status <> 'failed' and (gm.status <> 'suppressed' or gm.conversation_id is not null))
     order by at`,
    [c.id, c.reservation_id, c.booking_id, forStaff],
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, authorName: r.author_name, body: r.body, subject: r.subject, fileId: r.file_id, fileType: r.file_type, at: r.at, notSent: r.not_sent, byEmail: r.by_email, issueId: forStaff ? r.issue_id : null, taskId: forStaff ? r.task_id : null }));
}

export interface ConversationView {
  conversation: ConversationListRow;
  messages: ThreadMessage[];
  /** The latest guest message shown: opening it clears unread. */
  latestGuestMessageId: string | null;
  /** The guest's earlier stays, read-only. */
  earlier: { conversation: ConversationListRow; messages: ThreadMessage[] }[];
  /** For Quick Replies: the language and the placeholders' values. */
  language: MessageLanguage;
  values: QuickReplyValues;
}

export async function conversationView(pool: Pool, schema: string, propertyId: string, conversationId: string): Promise<ConversationView | null> {
  if (!isUuid(conversationId)) return null;
  return withTenant(pool, schema, async (tx) => {
    await tx.query(ENSURE_MESSAGING, [propertyId]);
    const row = (await tx.query<ListRow & { first_name: string | null; last_name: string | null; language: string | null; property_name: string; country: string; checkin_time: string; checkout_time: string; use_guest_language: boolean; fallback_language: MessageLanguage }>(
      `select ${LIST_COLUMNS}, g.first_name, g.last_name, g.language, p.name as property_name, p.country,
              to_char(pm.checkin_time, 'HH24:MI') as checkin_time, to_char(pm.checkout_time, 'HH24:MI') as checkout_time, pm.use_guest_language, pm.fallback_language
       from ${LIST_FROM} join properties p on p.id = c.property_id join property_messaging pm on pm.property_id = c.property_id where c.id = $1 and c.property_id = $2`,
      [conversationId, propertyId],
    )).rows[0];
    if (!row) return null;
    const messages = await threadIn(tx, row, true);
    const guest = messages.filter((m) => m.kind === "guest");
    // the guest's earlier stays at this property only (profiles are tenant-wide; another hotel's threads are not ours to show)
    const earlierRows = row.guest_id
      ? (await tx.query<ListRow>(
          `select ${LIST_COLUMNS} from ${LIST_FROM} where coalesce(r.primary_guest_id, b.booker_guest_id) = $1 and c.property_id = $4 and c.id <> $2 and c.last_message_at is not null
             and coalesce(r.arrival, (select min(x.arrival) from reservations x where x.booking_id = c.booking_id)) < $3::date
           order by arrival desc limit 10`,
          [row.guest_id, row.id, row.arrival, propertyId],
        )).rows
      : [];
    const earlier = [];
    for (const e of earlierRows) earlier.push({ conversation: toListRow(e), messages: await threadIn(tx, e, true) });
    const language = messageLanguage(row.language, row.use_guest_language, row.fallback_language);
    return {
      conversation: toListRow(row),
      messages,
      latestGuestMessageId: guest.length ? guest[guest.length - 1]!.id : null,
      earlier,
      language,
      values: {
        ...(row.first_name ? { firstName: row.first_name } : {}),
        ...(row.last_name ? { lastName: row.last_name } : {}),
        ...(row.room ? { room: row.room } : {}),
        arrival: dateText(row.arrival, language),
        departure: dateText(row.departure, language),
        checkInTime: row.checkin_time,
        checkOutTime: row.checkout_time,
        property: row.property_name,
      },
    };
  });
}

/** The Conversation as the guest sees it in the portal (no Internal Notes); empty before the first message. */
export async function portalConversation(pool: Pool, schema: string, key: string): Promise<ThreadMessage[] | null> {
  return withTenant(pool, schema, async (tx) => {
    const owner = await ownerByKey(tx, key);
    if (!owner) return null;
    const { rows } = await tx.query<ThreadOwner>(`select id, reservation_id, booking_id from conversations where ${ownerColumn(owner)} = $1`, [ownerId(owner)]);
    // no Conversation yet: the automatic messages already belong to it
    return threadIn(tx, rows[0] ?? { id: "00000000-0000-0000-0000-000000000000", reservation_id: owner.reservationId, booking_id: owner.bookingId }, false);
  });
}

/** A file the guest may open: carried by a message (not an Internal Note) of the link's Conversation. */
export async function portalConversationFile(pool: Pool, schema: string, key: string, fileId: string): Promise<StoredFile | null> {
  if (!isUuid(fileId)) return null;
  return withTenant(pool, schema, async (tx) => {
    const owner = await ownerByKey(tx, key);
    if (!owner) return null;
    const { rows } = await tx.query(
      `select 1 from conversation_messages m join conversations c on c.id = m.conversation_id
       where m.file_id = $1 and m.kind <> 'note' and c.${ownerColumn(owner)} = $2`,
      [fileId, ownerId(owner)],
    );
    return rows.length ? fileIn(tx, fileId) : null;
  });
}

export interface Escalation {
  conversationId: string;
  propertyId: string;
  guestName: string;
}

/**
 * Guest messages nobody opened for the property's time, counted in Desk Hours
 * only (the timer pauses while the desk is closed): marked once, for the
 * Property Manager to be told.
 */
export async function escalateConversations(pool: Pool, schema: string, now = new Date()): Promise<Escalation[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; property_id: string; unread_since: Date; guest_name: string; time_zone: string; desk_opens: string; desk_closes: string; escalation_minutes: number }>(
      `select c.id, c.property_id, c.unread_since, ${GUEST_NAME} as guest_name, p.time_zone,
              to_char(pm.desk_opens, 'HH24:MI') as desk_opens, to_char(pm.desk_closes, 'HH24:MI') as desk_closes, pm.escalation_minutes
       from ${LIST_FROM} join properties p on p.id = c.property_id join property_messaging pm on pm.property_id = c.property_id
       where c.unread_since is not null and c.escalated_at is null and c.unread_since <= $1::timestamptz - make_interval(mins => pm.escalation_minutes)`,
      [now],
    );
    const due: Escalation[] = [];
    for (const r of rows) {
      const hours: DeskHours = { opens: r.desk_opens, closes: r.desk_closes };
      if (deskMinutesBetween(r.unread_since, now, hours, r.time_zone, r.escalation_minutes) < r.escalation_minutes) continue;
      const { rowCount } = await tx.query("update conversations set escalated_at = $2 where id = $1 and escalated_at is null", [r.id, now]);
      if (rowCount) due.push({ conversationId: r.id, propertyId: r.property_id, guestName: r.guest_name });
    }
    return due;
  });
}

/** Telling the Property Manager failed: the escalation is due again next time. */
export async function releaseEscalation(pool: Pool, schema: string, conversationId: string): Promise<void> {
  await withTenant(pool, schema, (tx) => tx.query("update conversations set escalated_at = null where id = $1", [conversationId]));
}

export interface InboxSettings {
  deskOpens: string;
  deskCloses: string;
  /** From when guests can check in, for Quick Replies. */
  checkinTime: string;
  /** Conversations and their files are deleted this many months after the stay (1–12). */
  conversationMonths: number;
  emergencyPhone: string | null;
  escalationMinutes: number;
}

export async function inboxSettings(pool: Pool, schema: string, propertyId: string): Promise<InboxSettings> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  return withTenant(pool, schema, async (tx) => {
    await tx.query(ENSURE_MESSAGING, [propertyId]);
    const r = (await tx.query<{ desk_opens: string; desk_closes: string; checkin_time: string; emergency_phone: string | null; escalation_minutes: number; conversation_months: number }>(
      "select to_char(desk_opens, 'HH24:MI') as desk_opens, to_char(desk_closes, 'HH24:MI') as desk_closes, to_char(checkin_time, 'HH24:MI') as checkin_time, emergency_phone, escalation_minutes, conversation_months from property_messaging where property_id = $1",
      [propertyId],
    )).rows[0]!;
    return { deskOpens: r.desk_opens, deskCloses: r.desk_closes, checkinTime: r.checkin_time, emergencyPhone: r.emergency_phone, escalationMinutes: r.escalation_minutes, conversationMonths: r.conversation_months };
  });
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function setInboxSettings(pool: Pool, schema: string, propertyId: string, input: InboxSettings, userId: string): Promise<void> {
  if (!HHMM.test(input.deskOpens) || !HHMM.test(input.deskCloses) || !HHMM.test(input.checkinTime)) throw new Error("Give the times as HH:MM");
  if (!Number.isInteger(input.escalationMinutes) || input.escalationMinutes < 5 || input.escalationMinutes > 240) throw new Error("Escalation after 5 to 240 minutes");
  if (!Number.isInteger(input.conversationMonths) || input.conversationMonths < 1 || input.conversationMonths > 12) throw new Error("Keep Conversations for 1 to 12 months");
  const phone = input.emergencyPhone?.trim() || null;
  if (phone && !/^\+?[0-9 ()/-]{5,25}$/.test(phone)) throw new Error("The emergency number has digits, spaces and a leading + only");
  await withTenant(pool, schema, async (tx) => {
    await tx.query(ENSURE_MESSAGING, [propertyId]);
    await tx.query("update property_messaging set desk_opens = $2, desk_closes = $3, emergency_phone = $4, escalation_minutes = $5, checkin_time = $7, conversation_months = $8, updated_at = now(), updated_by = $6 where property_id = $1", [
      propertyId,
      input.deskOpens,
      input.deskCloses,
      phone,
      input.escalationMinutes,
      userId,
      input.checkinTime,
      input.conversationMonths,
    ]);
  });
}

export interface QuickReply {
  id: string;
  language: MessageLanguage;
  title: string;
  body: string;
}

export async function listQuickReplies(pool: Pool, schema: string, propertyId: string): Promise<QuickReply[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) => (await tx.query<QuickReply>("select id, language, title, body from quick_replies where property_id = $1 order by language, title", [propertyId])).rows);
}

export async function saveQuickReply(pool: Pool, schema: string, propertyId: string, input: { language: string; title: string; body: string }): Promise<void> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!isMessageLanguage(input.language)) throw new Error("Unknown language");
  if (!title || !body || title.length > 80 || body.length > 2000) throw new Error("A quick reply needs a title (up to 80 characters) and a text (up to 2,000)");
  await withTenant(pool, schema, (tx) =>
    tx.query("insert into quick_replies (property_id, language, title, body) values ($1, $2, $3, $4) on conflict (property_id, language, title) do update set body = excluded.body", [propertyId, input.language, title, body]),
  );
}

export async function deleteQuickReply(pool: Pool, schema: string, propertyId: string, id: string): Promise<void> {
  if (!isUuid(id)) return;
  await withTenant(pool, schema, (tx) => tx.query("delete from quick_replies where id = $1 and property_id = $2", [id, propertyId]));
}

/** Kept past retention while a dispute is open, or released again (ticket 43). */
export async function setConversationDisputed(pool: Pool, schema: string, propertyId: string, conversationId: string, disputed: boolean, userId: string): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const c = await lockConversation(tx, conversationId, propertyId);
    await tx.query("update conversations set disputed_at = case when $2 then coalesce(disputed_at, now()) end, disputed_by = case when $2 then coalesce(disputed_by, $3) end where id = $1", [c.id, disputed, userId]);
  });
}

/**
 * The retention job (ticket 43): Conversations whose stay ended more than
 * the property's months ago (12 unless shortened) go with their messages,
 * received mails and automatic copies; their files are handed to the file
 * retention (deleted from storage today). One kept for a dispute stays.
 * Mails that found no Conversation go after 30 days.
 */
export async function deleteExpiredConversations(pool: Pool, schema: string, today: string): Promise<number> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; stay_end: string; months: number; disputed: boolean }>(
      `select c.id, to_char(coalesce(r.departure, (select max(x.departure) from reservations x where x.booking_id = c.booking_id)), 'YYYY-MM-DD') as stay_end,
              coalesce(pm.conversation_months, 12) as months, c.disputed_at is not null as disputed
       from conversations c left join reservations r on r.id = c.reservation_id left join property_messaging pm on pm.property_id = c.property_id
       where c.disputed_at is null and coalesce(r.departure, (select max(x.departure) from reservations x where x.booking_id = c.booking_id)) < $1::date - interval '1 month'`,
      [today],
    );
    const gone = rows.filter((r) => r.stay_end && conversationExpired(r.stay_end, r.months, today, r.disputed)).map((r) => r.id);
    if (gone.length) {
      await tx.query("update stored_files set delete_after = $2 where id in (select file_id from conversation_messages where conversation_id = any($1::uuid[]) and file_id is not null)", [gone, today]);
      await tx.query("delete from conversations where id = any($1::uuid[])", [gone]);
    }
    await tx.query("delete from inbound_mails where conversation_id is null and received_at < $1::date - interval '30 days'", [today]);
    return gone.length;
  });
}

export type TaskFromMessage = "maintenance" | "housekeeping";
export const TASKS_FROM_MESSAGES: readonly TaskFromMessage[] = ["maintenance", "housekeeping"];

/** The rooms a Conversation's guests sleep in (for a Booker's, every room of the booking): tonight's first, then the next, then the last. */
export async function conversationRooms(pool: Pool, schema: string, propertyId: string, conversationId: string): Promise<{ id: string; number: string }[]> {
  if (!isUuid(conversationId)) return [];
  return withTenant(pool, schema, async (tx) => roomsIn(tx, propertyId, conversationId));
}

async function roomsIn(tx: PoolClient, propertyId: string, conversationId: string): Promise<{ id: string; number: string; reservation_id: string }[]> {
  return (await tx.query<{ id: string; number: string; reservation_id: string }>(
    `select distinct on (m.id) m.id, m.number, a.reservation_id from conversations c join reservations r on r.id = c.reservation_id or r.booking_id = c.booking_id
       join room_assignments a on a.reservation_id = r.id join rooms m on m.id = a.room_id join properties p on p.id = c.property_id
     where c.id = $1 and c.property_id = $2 and r.status <> 'cancelled'
     order by m.id, case when a.from_date <= p.business_date and a.to_date > p.business_date then 0 when a.from_date > p.business_date then 1 else 2 end, abs(a.from_date - p.business_date)`,
    [conversationId, propertyId],
  )).rows;
}

/**
 * A guest's message becomes work for the guest's room (ticket 43): a
 * Maintenance Issue, or a Housekeeping Task for the Business Date (the
 * room's hand-made task of the day takes the request and opens again if it
 * was done), linked back to the message. With several rooms (a Booker's
 * Conversation) staff name the room. Done once per message and kind.
 */
export async function messageToTask(pool: Pool, schema: string, propertyId: string, messageId: string, kind: TaskFromMessage, viewer: Viewer, roomId: string | null = null): Promise<string> {
  if (!isUuid(messageId)) throw new Error("Message not found");
  if (!can(viewer.actor, "use_guest_inbox", propertyId)) throw new Error("Not allowed");
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; body: string; conversation_id: string; business_date: string }>(
      `select m.id, m.body, m.conversation_id, to_char(p.business_date, 'YYYY-MM-DD') as business_date
       from conversation_messages m join conversations c on c.id = m.conversation_id join properties p on p.id = c.property_id
       where m.id = $1 and m.kind = 'guest' and c.property_id = $2 for update of m`,
      [messageId, propertyId],
    );
    const m = rows[0];
    if (!m) throw new Error("Message not found");
    const done =
      kind === "maintenance"
        ? (await tx.query<{ id: string }>("select id from maintenance_issues where conversation_message_id = $1", [m.id])).rows[0]
        : (await tx.query<{ id: string }>("select task_id as id from housekeeping_task_messages where message_id = $1", [m.id])).rows[0];
    if (done) return done.id;
    const rooms = await roomsIn(tx, propertyId, m.conversation_id);
    const room = roomId ? rooms.find((r) => r.id === roomId) : rooms.length === 1 ? rooms[0] : undefined;
    if (!rooms.length) throw new Error("The stay has no room yet");
    if (!room) throw new Error("Choose the room");
    const note = `Guest: ${m.body || "(attachment)"}`.slice(0, 1000);
    if (kind === "maintenance") {
      return (await reportIssueIn(tx, { propertyId, roomId: room.id, place: "", pick: "other", urgency: "today", note, photoFileId: null, block: null, conversationMessageId: m.id }, viewer)).id;
    }
    const { rows: task } = await tx.query<{ id: string }>(
      `insert into housekeeping_tasks (property_id, room_id, business_date, kind, reservation_id, note, minutes, created_by)
       values ($1, $2, $3, 'clean', $4, $5, $6, $7)
       on conflict (room_id, business_date, kind) do update set
         note = case when housekeeping_tasks.note = '' then excluded.note else housekeeping_tasks.note || E'\\n' || excluded.note end,
         status = case when housekeeping_tasks.status in ('done', 'skipped') then 'open' else housekeeping_tasks.status end,
         changed = true
       returning id`,
      [propertyId, room.id, m.business_date, room.reservation_id, note, DEFAULT_MINUTES.clean, viewer.userId],
    );
    await tx.query("insert into housekeeping_task_messages (task_id, message_id) values ($1, $2)", [task[0]!.id, m.id]);
    return task[0]!.id;
  });
}
