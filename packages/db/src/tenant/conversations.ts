import type { Pool, PoolClient } from "pg";
import { deskMinutesBetween, deskNight, isMessageLanguage, messageLanguage, portalLinkOpen, todayIn, type DeskHours, type MessageLanguage, type QuickReplyValues } from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { fileIn, setFileRetention, type StoredFile } from "./files";
import { ENSURE_MESSAGING, enabledTypes, queueGuestMessageIn, type PortalLinks } from "./messages";
import { PORTAL_USER, reservationByKey } from "./portal";
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
  guestId: string | null;
}

interface ConversationRow {
  id: string;
  property_id: string;
  reservation_id: string | null;
  booking_id: string | null;
  guest_id: string | null;
  desk_closed_night: string | null;
}

/** The Conversation of a stay or booking, made on first use; locked for a change. */
async function conversationIn(tx: PoolClient, owner: ConversationOwner): Promise<ConversationRow> {
  await tx.query(
    `insert into conversations (property_id, reservation_id, booking_id, guest_id) values ($1, $2, $3, $4)
     on conflict do nothing`,
    [owner.propertyId, owner.reservationId, owner.bookingId, owner.guestId],
  );
  const { rows } = await tx.query<ConversationRow>(
    `select id, property_id, reservation_id, booking_id, guest_id, to_char(desk_closed_night, 'YYYY-MM-DD') as desk_closed_night from conversations
     where ${owner.reservationId ? "reservation_id" : "booking_id"} = $1 for update`,
    [owner.reservationId ?? owner.bookingId],
  );
  return rows[0]!;
}

/** A Conversation of the property, locked; another property's is simply not found. */
async function lockConversation(tx: PoolClient, id: string, propertyId: string): Promise<ConversationRow> {
  if (!isUuid(id)) throw new Error("Conversation not found");
  const { rows } = await tx.query<ConversationRow>(
    "select id, property_id, reservation_id, booking_id, guest_id, to_char(desk_closed_night, 'YYYY-MM-DD') as desk_closed_night from conversations where id = $1 and property_id = $2 for update",
    [id, propertyId],
  );
  if (!rows[0]) throw new Error("Conversation not found");
  return rows[0];
}

/** What a Portal Link opens: the stay, or the booking (the Booker's link); null when it opens nothing. */
async function ownerByKey(tx: PoolClient, key: string): Promise<(ConversationOwner & { key: string }) | null> {
  try {
    const r = await reservationByKey(tx, key);
    return { reservationId: r.id, bookingId: null, propertyId: r.property_id, guestId: r.primary_guest_id, key };
  } catch {
    // not a stay's link: perhaps the Booker's
  }
  const { rows } = await tx.query<{ id: string; property_id: string; booker_guest_id: string | null; departure: string | null; time_zone: string }>(
    `select b.id, b.property_id, b.booker_guest_id, p.time_zone,
            to_char((select max(departure) from reservations r where r.booking_id = b.id and r.status <> 'cancelled'), 'YYYY-MM-DD') as departure
     from bookings b join properties p on p.id = b.property_id where b.portal_key = $1`,
    [key],
  );
  const b = rows[0];
  if (!b?.departure || !portalLinkOpen(b.departure, todayIn(b.time_zone))) return null;
  return { reservationId: null, bookingId: b.id, propertyId: b.property_id, guestId: b.booker_guest_id, key };
}

/** The staff's own Conversation of a reservation (to start one from the reservation). */
export async function conversationOfReservation(pool: Pool, schema: string, reservationId: string): Promise<{ id: string; propertyId: string }> {
  if (!isUuid(reservationId)) throw new Error("Reservation not found");
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ property_id: string; primary_guest_id: string }>("select property_id, primary_guest_id from reservations where id = $1", [reservationId]);
    if (!rows[0]) throw new Error("Reservation not found");
    const c = await conversationIn(tx, { reservationId, bookingId: null, propertyId: rows[0].property_id, guestId: rows[0].primary_guest_id });
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

/** Where a guest message by email goes: the stay's guest with the stay's link; for a booking the Booker with the booking's link. */
async function recipientIn(tx: PoolClient, c: ConversationRow): Promise<{ reservationId: string; toEmail?: string; linkKey: string } | null> {
  if (c.reservation_id) {
    const { rows } = await tx.query<{ portal_key: string }>("select portal_key from reservations where id = $1", [c.reservation_id]);
    return { reservationId: c.reservation_id, linkKey: rows[0]!.portal_key };
  }
  const { rows } = await tx.query<{ reservation_id: string | null; email: string | null; portal_key: string }>(
    `select (select r.id from reservations r where r.booking_id = b.id and r.status <> 'cancelled' order by r.created_at limit 1) as reservation_id,
            nullif(trim(g.email), '') as email, b.portal_key
     from bookings b left join guests g on g.id = b.booker_guest_id where b.id = $1`,
    [c.booking_id],
  );
  const b = rows[0];
  if (!b?.reservation_id || !b.email) return null;
  return { reservationId: b.reservation_id, toEmail: b.email, linkKey: b.portal_key };
}

const GUEST_MESSAGES_PER_HOUR = 30;

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
    const c = await conversationIn(tx, owner);
    // the link is the only authority: a flood from it stops
    const { rows: recent } = await tx.query<{ n: string }>("select count(*) as n from conversation_messages where conversation_id = $1 and kind = 'guest' and created_at > now() - interval '1 hour'", [c.id]);
    if (Number(recent[0]!.n) >= GUEST_MESSAGES_PER_HOUR) throw new Error("Too many messages in a short time; please wait a little");
    const fileId = await attachIn(tx, input.fileId, PORTAL_USER);
    const { rows: who } = await tx.query<{ name: string }>("select trim(first_name || ' ' || last_name) as name from guests where id = $1", [c.guest_id]);
    const guestName = who[0]?.name ?? "";
    const { rows } = await tx.query<{ id: string; created_at: Date }>(
      "insert into conversation_messages (conversation_id, kind, user_id, author_name, body, file_id) values ($1, 'guest', $2, $3, $4, $5) returning id, created_at",
      [c.id, PORTAL_USER, guestName, body, fileId],
    );
    const at = rows[0]!.created_at;
    await tx.query(
      `update conversations set last_message_at = $2, last_guest_message_at = $2, waiting_since = coalesce(waiting_since, $2),
         escalated_at = case when unread_since is null then null else escalated_at end, unread_since = coalesce(unread_since, $2)
       where id = $1`,
      [c.id, at],
    );
    // outside Desk Hours: one automatic reply a night, where the property has it on
    const facts = await factsIn(tx, c.property_id);
    const night = deskNight(now, { opens: facts.desk_opens, closes: facts.desk_closes }, facts.time_zone);
    let autoReplied = false;
    if (night && c.desk_closed_night !== night && enabledTypes(facts.switched).desk_closed) {
      const to = await recipientIn(tx, c);
      if (to) {
        await queueGuestMessageIn(tx, { reservationId: to.reservationId, type: "desk_closed", triggerKey: `${c.id}:${night}`, now, links, linkKey: to.linkKey, ...(to.toEmail ? { toEmail: to.toEmail } : {}) });
        await tx.query("update conversations set desk_closed_night = $2 where id = $1", [c.id, night]);
        autoReplied = true;
      }
    }
    return { conversationId: c.id, propertyId: c.property_id, messageId: rows[0]!.id, guestName, autoReplied };
  });
}

/** A staff member answers (the guest is emailed with the Portal Link) or leaves an Internal Note the guest never sees. */
export async function postStaffMessage(
  pool: Pool,
  schema: string,
  propertyId: string,
  conversationId: string,
  author: { userId: string; name: string },
  input: { body: string; note: boolean; fileId: string | null },
  links: PortalLinks | null,
  now = new Date(),
): Promise<{ messageId: string }> {
  const body = input.body.trim().slice(0, 5000);
  if (!body && !input.fileId) throw new Error("Write a message or add a file");
  return withTenant(pool, schema, async (tx) => {
    const c = await lockConversation(tx, conversationId, propertyId);
    const fileId = await attachIn(tx, input.fileId, author.userId);
    const { rows } = await tx.query<{ id: string; created_at: Date }>(
      "insert into conversation_messages (conversation_id, kind, user_id, author_name, body, file_id) values ($1, $2, $3, $4, $5, $6) returning id, created_at",
      [c.id, input.note ? "note" : "staff", author.userId, author.name, body, fileId],
    );
    if (!input.note) {
      // answered: no longer waiting; answering is opening what the guest wrote
      await tx.query(
        `update conversations set last_message_at = $2, waiting_since = null, seen_until = greatest(seen_until, last_guest_message_at), unread_since = null, escalated_at = null where id = $1`,
        [c.id, rows[0]!.created_at],
      );
      const to = await recipientIn(tx, c);
      if (to) {
        const message = [body, fileId ? "(+ 1 attachment)" : ""].filter(Boolean).join(" ");
        await queueGuestMessageIn(tx, { reservationId: to.reservationId, type: "inbox_reply", triggerKey: rows[0]!.id, userId: author.userId, now, links, linkKey: to.linkKey, message, ...(to.toEmail ? { toEmail: to.toEmail } : {}) });
      }
    }
    return { messageId: rows[0]!.id };
  });
}

/** A staff member opened the Conversation up to a guest message: unread clears only when that is the latest one. */
export async function markConversationSeen(pool: Pool, schema: string, propertyId: string, conversationId: string, upToMessageId: string): Promise<void> {
  if (!isUuid(conversationId) || !isUuid(upToMessageId)) return;
  await withTenant(pool, schema, async (tx) => {
    const upTo = (await tx.query<{ created_at: Date }>("select created_at from conversation_messages where id = $1 and conversation_id = $2 and kind = 'guest'", [upToMessageId, conversationId])).rows[0];
    if (!upTo) return;
    // compared in the database's own precision: the message's time as stored
    await tx.query(
      `update conversations c set seen_until = greatest(coalesce(c.seen_until, m.created_at), m.created_at),
         unread_since = (select min(n.created_at) from conversation_messages n where n.conversation_id = c.id and n.kind = 'guest' and n.created_at > m.created_at),
         escalated_at = case when exists (select 1 from conversation_messages n where n.conversation_id = c.id and n.kind = 'guest' and n.created_at > m.created_at) then c.escalated_at end
       from conversation_messages m where m.id = $2 and c.id = $1 and c.property_id = $3 and c.unread_since is not null and c.unread_since <= m.created_at`,
      [conversationId, upToMessageId, propertyId],
    );
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

const LIST_COLUMNS = `c.id, c.property_id, c.reservation_id, c.booking_id, c.unread_since, c.waiting_since, c.claimed_by, c.claimed_name, c.last_message_at,
  coalesce(nullif(trim(g.first_name || ' ' || g.last_name), ''), co.name, '') as guest_name, b.confirmation_number,
  to_char(coalesce(r.arrival, (select min(x.arrival) from reservations x where x.booking_id = c.booking_id)), 'YYYY-MM-DD') as arrival,
  to_char(coalesce(r.departure, (select max(x.departure) from reservations x where x.booking_id = c.booking_id)), 'YYYY-MM-DD') as departure,
  (select rm.number from room_assignments a join rooms rm on rm.id = a.room_id where a.reservation_id = r.id order by a.from_date desc limit 1) as room,
  coalesce((select m.body from conversation_messages m where m.conversation_id = c.id and m.kind <> 'note' order by m.created_at desc limit 1), '') as last_text`;
const LIST_FROM = `conversations c left join reservations r on r.id = c.reservation_id
  join bookings b on b.id = coalesce(c.booking_id, r.booking_id)
  left join guests g on g.id = c.guest_id left join companies co on co.id = b.booker_company_id`;

type ListRow = { id: string; property_id: string; reservation_id: string | null; booking_id: string | null; unread_since: Date | null; waiting_since: Date | null; claimed_by: string | null; claimed_name: string | null; last_message_at: Date | null; guest_name: string; confirmation_number: string; arrival: string; departure: string; room: string | null; last_text: string };
const toListRow = (r: ListRow): ConversationListRow => ({
  id: r.id,
  propertyId: r.property_id,
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

/** The Guest Inbox of a property: unread first, then the newest; Conversations with a message only. */
export async function listConversations(pool: Pool, schema: string, propertyId: string): Promise<ConversationListRow[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<ListRow>(`select ${LIST_COLUMNS} from ${LIST_FROM} where c.property_id = $1 and c.last_message_at is not null order by (c.unread_since is null), c.last_message_at desc limit 300`, [propertyId])).rows.map(toListRow),
  );
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
}

/** The thread: guest and staff messages, Internal Notes (staff only) and the stay's automatic messages, oldest first. */
async function threadIn(tx: PoolClient, c: { id: string; reservation_id: string | null }, withNotes: boolean): Promise<ThreadMessage[]> {
  const { rows } = await tx.query<{ id: string; kind: ThreadMessage["kind"]; author_name: string; body: string; subject: string | null; file_id: string | null; file_type: string | null; at: Date }>(
    `select m.id, m.kind, m.author_name, m.body, null as subject, m.file_id, f.content_type as file_type, m.created_at as at
     from conversation_messages m left join stored_files f on f.id = m.file_id where m.conversation_id = $1 and ($3 or m.kind <> 'note')
     union all
     select gm.id, 'auto', '', gm.body_text, gm.subject, null, null, gm.send_after
     from guest_messages gm where gm.type <> 'inbox_reply' and gm.send_after <= now()
       and (gm.reservation_id = $2 or gm.trigger_key like $1::text || ':%')
     order by at`,
    [c.id, c.reservation_id, withNotes],
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, authorName: r.author_name, body: r.body, subject: r.subject, fileId: r.file_id, fileType: r.file_type, at: r.at }));
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
    const row = (await tx.query<ListRow & { guest_id: string | null; first_name: string | null; last_name: string | null; language: string | null; property_name: string }>(
      `select ${LIST_COLUMNS}, c.guest_id, g.first_name, g.last_name, g.language, p.name as property_name from ${LIST_FROM} join properties p on p.id = c.property_id where c.id = $1 and c.property_id = $2`,
      [conversationId, propertyId],
    )).rows[0];
    if (!row) return null;
    const messages = await threadIn(tx, row, true);
    const guest = messages.filter((m) => m.kind === "guest");
    const earlierRows = row.guest_id
      ? (await tx.query<ListRow>(
          `select ${LIST_COLUMNS} from ${LIST_FROM} where c.guest_id = $1 and c.id <> $2 and c.last_message_at is not null
             and coalesce(r.arrival, (select min(x.arrival) from reservations x where x.booking_id = c.booking_id)) < $3::date
           order by arrival desc limit 10`,
          [row.guest_id, row.id, row.arrival],
        )).rows
      : [];
    const earlier = [];
    for (const e of earlierRows) earlier.push({ conversation: toListRow(e), messages: await threadIn(tx, e, true) });
    await tx.query(ENSURE_MESSAGING, [row.property_id]);
    const settings = (await tx.query<{ use_guest_language: boolean; fallback_language: MessageLanguage }>("select use_guest_language, fallback_language from property_messaging where property_id = $1", [row.property_id])).rows[0]!;
    return {
      conversation: toListRow(row),
      messages,
      latestGuestMessageId: guest.length ? guest[guest.length - 1]!.id : null,
      earlier,
      language: messageLanguage(row.language, settings.use_guest_language, settings.fallback_language),
      values: {
        ...(row.first_name ? { firstName: row.first_name } : {}),
        ...(row.last_name ? { lastName: row.last_name } : {}),
        ...(row.room ? { room: row.room } : {}),
        arrival: row.arrival,
        departure: row.departure,
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
    const { rows } = await tx.query<{ id: string; reservation_id: string | null }>(
      `select id, reservation_id from conversations where ${owner.reservationId ? "reservation_id" : "booking_id"} = $1`,
      [owner.reservationId ?? owner.bookingId],
    );
    if (rows[0]) return threadIn(tx, rows[0], false);
    // no Conversation yet: the stay's automatic messages already belong to it
    return owner.reservationId ? threadIn(tx, { id: "00000000-0000-0000-0000-000000000000", reservation_id: owner.reservationId }, false) : [];
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
       where m.file_id = $1 and m.kind <> 'note' and ${owner.reservationId ? "c.reservation_id" : "c.booking_id"} = $2`,
      [fileId, owner.reservationId ?? owner.bookingId],
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
      `select c.id, c.property_id, c.unread_since, coalesce(nullif(trim(g.first_name || ' ' || g.last_name), ''), '') as guest_name, p.time_zone,
              to_char(coalesce(m.desk_opens, '07:00'), 'HH24:MI') as desk_opens, to_char(coalesce(m.desk_closes, '22:00'), 'HH24:MI') as desk_closes, coalesce(m.escalation_minutes, 15) as escalation_minutes
       from conversations c join properties p on p.id = c.property_id left join property_messaging m on m.property_id = c.property_id left join guests g on g.id = c.guest_id
       where c.unread_since is not null and c.escalated_at is null and c.unread_since <= $1::timestamptz - make_interval(mins => coalesce(m.escalation_minutes, 15))`,
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

export interface InboxSettings {
  deskOpens: string;
  deskCloses: string;
  emergencyPhone: string | null;
  escalationMinutes: number;
}

export async function inboxSettings(pool: Pool, schema: string, propertyId: string): Promise<InboxSettings> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  return withTenant(pool, schema, async (tx) => {
    await tx.query(ENSURE_MESSAGING, [propertyId]);
    const r = (await tx.query<{ desk_opens: string; desk_closes: string; emergency_phone: string | null; escalation_minutes: number }>(
      "select to_char(desk_opens, 'HH24:MI') as desk_opens, to_char(desk_closes, 'HH24:MI') as desk_closes, emergency_phone, escalation_minutes from property_messaging where property_id = $1",
      [propertyId],
    )).rows[0]!;
    return { deskOpens: r.desk_opens, deskCloses: r.desk_closes, emergencyPhone: r.emergency_phone, escalationMinutes: r.escalation_minutes };
  });
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function setInboxSettings(pool: Pool, schema: string, propertyId: string, input: InboxSettings, userId: string): Promise<void> {
  if (!HHMM.test(input.deskOpens) || !HHMM.test(input.deskCloses)) throw new Error("Give the Desk Hours as HH:MM");
  if (!Number.isInteger(input.escalationMinutes) || input.escalationMinutes < 5 || input.escalationMinutes > 240) throw new Error("Escalation after 5 to 240 minutes");
  const phone = input.emergencyPhone?.trim() || null;
  if (phone && !/^\+?[0-9 ()/-]{5,25}$/.test(phone)) throw new Error("The emergency number has digits, spaces and a leading + only");
  await withTenant(pool, schema, async (tx) => {
    await tx.query(ENSURE_MESSAGING, [propertyId]);
    await tx.query("update property_messaging set desk_opens = $2, desk_closes = $3, emergency_phone = $4, escalation_minutes = $5, updated_at = now(), updated_by = $6 where property_id = $1", [
      propertyId,
      input.deskOpens,
      input.deskCloses,
      phone,
      input.escalationMinutes,
      userId,
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
