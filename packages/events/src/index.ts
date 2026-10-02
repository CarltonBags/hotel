import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DATA_KINDS } from "@hoteloftware/domain";

type Queryable = Pool | PoolClient;

/** Postgres channel the worker listens on; payloads are hints (tenant, user, id), never data. */
export const EVENTS_CHANNEL = "hs_events";

export interface NotificationInput {
  tenantId: string;
  /** null = every user of the tenant */
  userId: string | null;
  kind: string;
  title: string;
  body?: string;
  href?: string;
}

export interface Notification {
  id: number;
  tenantId: string;
  userId: string | null;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  createdAt: Date;
}

export interface EventHint {
  tenantId: string;
  userId: string | null;
  id: number;
}

/** Store a notification and announce it. Runs in the caller's transaction when given a client. */
export async function publishNotification(db: Queryable, input: NotificationInput): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `insert into control.notifications (tenant_id, user_id, kind, title, body, href) values ($1, $2, $3, $4, $5, $6) returning id`,
    [input.tenantId, input.userId, input.kind, input.title, input.body ?? "", input.href ?? null],
  );
  const id = Number(rows[0]!.id);
  const hint: EventHint = { tenantId: input.tenantId, userId: input.userId, id };
  await db.query("select pg_notify($1, $2)", [EVENTS_CHANNEL, JSON.stringify(hint)]);
  return id;
}

export { DATA_CHANGE_PREFIX, isDataChange } from "@hoteloftware/domain";

/**
 * Tell every user of the tenant that data of a kind changed at a property, so
 * open lists can refresh. Carries no personal data: kind and property id only.
 */
export function publishDataChange(db: Queryable, input: { tenantId: string; kind: "reservations"; propertyId: string }): Promise<number> {
  // the property id rides in the body: these rows are tenant-wide and carry no personal data
  return publishNotification(db, { tenantId: input.tenantId, userId: null, kind: DATA_KINDS[input.kind], title: "", body: input.propertyId });
}

/** The newest notification id, the starting cursor for a fresh stream. */
export async function latestNotificationId(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ id: string | null }>("select max(id) as id from control.notifications");
  return Number(rows[0]?.id ?? 0);
}

/** Delete notifications older than the retention; they are transient staff alerts, not records. */
export async function pruneNotifications(db: Queryable, olderThanDays = 30): Promise<number> {
  const { rowCount } = await db.query("delete from control.notifications where created_at < now() - ($1 || ' days')::interval", [String(olderThanDays)]);
  return rowCount ?? 0;
}

/** Notifications a user missed: their own and tenant-wide ones after the cursor, oldest first. */
export async function notificationsAfter(
  db: Queryable,
  input: { tenantId: string; userId: string; afterId: number; limit?: number },
): Promise<Notification[]> {
  const { rows } = await db.query<{
    id: string;
    tenant_id: string;
    user_id: string | null;
    kind: string;
    title: string;
    body: string;
    href: string | null;
    created_at: Date;
  }>(
    `select id, tenant_id, user_id, kind, title, body, href, created_at
       from control.notifications
      where tenant_id = $1 and (user_id = $2 or user_id is null) and id > $3
      order by id
      limit $4`,
    [input.tenantId, input.userId, input.afterId, input.limit ?? 100],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    tenantId: r.tenant_id,
    userId: r.user_id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    href: r.href,
    createdAt: r.created_at,
  }));
}

export function parseEventHint(payload: string | undefined): EventHint | null {
  try {
    const v = JSON.parse(payload ?? "") as Partial<EventHint>;
    if (typeof v.tenantId !== "string" || typeof v.id !== "number") return null;
    return { tenantId: v.tenantId, userId: typeof v.userId === "string" ? v.userId : null, id: v.id };
  } catch {
    return null;
  }
}

/**
 * Short-lived token the staff app issues so the browser can open the SSE
 * stream at the worker (EventSource cannot send headers, so it rides in the URL).
 * HMAC-SHA256 over a base64url JSON payload with the shared auth secret.
 */
export interface EventsClaims {
  tenantId: string;
  userId: string;
}

/** Claims plus the expiry, so the stream can end when the token does. */
export interface VerifiedEventsClaims extends EventsClaims {
  exp: number;
}

const PURPOSE = "events";

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signEventsToken(claims: EventsClaims, secret: string, ttlSeconds = 600): string {
  const payload = Buffer.from(JSON.stringify({ p: PURPOSE, ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyEventsToken(token: string, secret: string): VerifiedEventsClaims | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, "base64url").toString()) as Partial<EventsClaims> & { exp?: number; p?: string };
    if (v.p !== PURPOSE || typeof v.tenantId !== "string" || typeof v.userId !== "string" || typeof v.exp !== "number") return null;
    if (v.exp < Date.now() / 1000) return null;
    return { tenantId: v.tenantId, userId: v.userId, exp: v.exp };
  } catch {
    return null;
  }
}
