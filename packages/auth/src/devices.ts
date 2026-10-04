import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import { PIN_MAX_TRIES, canUsePin, deviceIdleMinutes, pinProblem, resolveTenantSlugFromHeaders } from "@hoteloftware/domain";
import { findProperty, findTenantBySlug, loadActor } from "@hoteloftware/db";

/**
 * Devices and PIN Sign-in (ticket 14, decided in "Shared-device login for
 * floor staff"). A Device is enrolled to one property with a one-time code
 * (QR) and then carries a long-lived token, stored hashed. On a staff Device,
 * floor roles sign in by choosing their name and entering a PIN; the session
 * is valid only together with that Device's token, and revoking the Device
 * ends it. Five wrong PINs lock the user on every Device.
 */

export const DEVICE_COOKIE = "hs_device";
const ENROL_MINUTES = 15;
const LOCKED = "Locked after too many wrong PINs; ask your supervisor to reset it";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const secret = () => randomBytes(32).toString("base64url");

export type DeviceKind = "staff" | "guest";

/** A one-time enrolment code (shown as QR) for a Device of the property. */
export async function createEnrolment(
  pool: Pool,
  input: { tenantId: string; propertyId: string; kind: DeviceKind; name: string; ownerUserId?: string | null; userIds?: string[]; createdBy: string },
): Promise<{ code: string; expiresAt: Date }> {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new Error("Give the Device a name");
  if (input.kind !== "staff" && input.kind !== "guest") throw new Error("Staff or guest device");
  // a guest device has no staff sign-in; the people named must be of this tenant
  const people = input.kind === "guest" ? [] : [...new Set(input.ownerUserId ? [input.ownerUserId] : (input.userIds ?? []))];
  const known = (await pool.query('select count(*)::int as n from control."user" where tenant_id = $1 and id = any($2::text[])', [input.tenantId, people])).rows[0].n;
  if (known !== people.length) throw new Error("Unknown user");
  const code = secret();
  const { rows } = await pool.query<{ expires_at: Date }>(
    `insert into control.device_enrolments (code_hash, tenant_id, property_id, kind, name, owner_user_id, user_ids, created_by, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(mins => $9)) returning expires_at`,
    [hash(code), input.tenantId, input.propertyId, input.kind, name, input.kind === "guest" ? null : (input.ownerUserId ?? null), input.ownerUserId ? [] : people, input.createdBy, ENROL_MINUTES],
  );
  return { code, expiresAt: rows[0]!.expires_at };
}

/** Redeem an enrolment code on the Device: once, within 15 minutes, at its tenant. Returns the Device token to keep. */
export async function redeemEnrolment(pool: Pool, input: { tenantId: string; code: string }): Promise<{ deviceId: string; token: string; kind: DeviceKind }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const e = (await client.query<{ tenant_id: string; property_id: string; kind: DeviceKind; name: string; owner_user_id: string | null; user_ids: string[]; created_by: string }>(
      "update control.device_enrolments set used_at = now() where code_hash = $1 and tenant_id = $2 and used_at is null and expires_at > now() returning tenant_id, property_id, kind, name, owner_user_id, user_ids, created_by",
      [hash(input.code), input.tenantId],
    )).rows[0];
    if (!e) throw new Error("This enrolment code is not valid (used, expired or for another hotel)");
    const token = secret();
    const { rows } = await client.query<{ id: string }>(
      "insert into control.devices (tenant_id, property_id, kind, name, owner_user_id, token_hash, enrolled_by) values ($1, $2, $3, $4, $5, $6, $7) returning id",
      [e.tenant_id, e.property_id, e.kind, e.name, e.owner_user_id, hash(token), e.created_by],
    );
    const users = e.owner_user_id ? [e.owner_user_id] : e.user_ids;
    for (const u of users) await client.query("insert into control.device_users (device_id, user_id) values ($1, $2) on conflict do nothing", [rows[0]!.id, u]);
    await client.query("commit");
    return { deviceId: rows[0]!.id, token, kind: e.kind };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export interface DeviceInfo {
  id: string;
  tenantId: string;
  propertyId: string;
  kind: DeviceKind;
  name: string;
  revoked: boolean;
  ownerUserId: string | null;
  userIds: string[];
}

/** The Device a token belongs to (also a revoked one, so it can be told to wipe); touches its last use. */
export async function deviceByToken(pool: Pool, token: string | null | undefined): Promise<DeviceInfo | null> {
  if (!token) return null;
  const d = (await pool.query<{ id: string; tenant_id: string; property_id: string; kind: DeviceKind; name: string; revoked: boolean; owner_user_id: string | null; user_ids: string[] | null }>(
    `update control.devices set last_seen_at = case when revoked_at is null then now() else last_seen_at end where token_hash = $1
     returning id, tenant_id, property_id, kind, name, revoked_at is not null as revoked, owner_user_id,
       (select array_agg(user_id) from control.device_users where device_id = control.devices.id) as user_ids`,
    [hash(token)],
  )).rows[0];
  if (!d) return null;
  return { id: d.id, tenantId: d.tenant_id, propertyId: d.property_id, kind: d.kind, name: d.name, revoked: d.revoked, ownerUserId: d.owner_user_id, userIds: d.user_ids ?? [] };
}

export interface DeviceRow {
  id: string;
  propertyId: string;
  kind: DeviceKind;
  name: string;
  ownerUserId: string | null;
  userIds: string[];
  enrolledAt: Date;
  lastSeenAt: Date | null;
  lastUserId: string | null;
  revokedAt: Date | null;
}

/** The tenant's Devices with last use and last user. */
export async function listDevices(pool: Pool, tenantId: string, propertyId?: string): Promise<DeviceRow[]> {
  const { rows } = await pool.query<{ id: string; property_id: string; kind: DeviceKind; name: string; owner_user_id: string | null; user_ids: string[] | null; enrolled_at: Date; last_seen_at: Date | null; last_user_id: string | null; revoked_at: Date | null }>(
    `select d.id, d.property_id, d.kind, d.name, d.owner_user_id, (select array_agg(user_id) from control.device_users where device_id = d.id) as user_ids,
       d.enrolled_at, d.last_seen_at, d.last_user_id, d.revoked_at
     from control.devices d where d.tenant_id = $1 and ($2::uuid is null or d.property_id = $2) order by d.revoked_at nulls first, d.enrolled_at desc`,
    [tenantId, propertyId ?? null],
  );
  return rows.map((r) => ({ id: r.id, propertyId: r.property_id, kind: r.kind, name: r.name, ownerUserId: r.owner_user_id, userIds: r.user_ids ?? [], enrolledAt: r.enrolled_at, lastSeenAt: r.last_seen_at, lastUserId: r.last_user_id, revokedAt: r.revoked_at }));
}

/** Who may sign in on a shared staff Device: people of the tenant, replaced in one go. */
export async function setDeviceUsers(pool: Pool, scope: { tenantId: string; propertyId: string }, deviceId: string, userIds: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const shared = await client.query(
      "select 1 from control.devices where id = $1 and tenant_id = $2 and property_id = $3 and owner_user_id is null and revoked_at is null for update",
      [deviceId, scope.tenantId, scope.propertyId],
    );
    if (!shared.rowCount) throw new Error("Device not found");
    await client.query("delete from control.device_users where device_id = $1", [deviceId]);
    await client.query('insert into control.device_users (device_id, user_id) select $1, id from control."user" where tenant_id = $2 and id = any($3::text[])', [deviceId, scope.tenantId, [...new Set(userIds)]]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/** End every session on the Device. */
async function endDeviceSessions(pool: Pool, deviceId: string): Promise<void> {
  await pool.query("delete from control.session where id in (select session_id from control.device_sessions where device_id = $1)", [deviceId]);
}

/** Revoke a Device: every session on it ends at once; it is told to wipe its data when it next calls. */
export async function revokeDevice(pool: Pool, scope: { tenantId: string; propertyId: string }, deviceId: string, byUserId: string): Promise<void> {
  const { rowCount } = await pool.query("update control.devices set revoked_at = now(), revoked_by = $4 where id = $1 and tenant_id = $2 and property_id = $3 and revoked_at is null", [deviceId, scope.tenantId, scope.propertyId, byUserId]);
  if (!rowCount) throw new Error("Device not found");
  await endDeviceSessions(pool, deviceId);
}

export interface DeviceSession {
  deviceId: string;
  propertyId: string;
  /** A first or reset PIN: the user chooses their own before anything else. */
  mustChange: boolean;
}

/**
 * Check a session against Devices. A session made by PIN is valid only from
 * its Device (the request carries that Device's token), while the Device is
 * not revoked, and until it sits idle longer than its minutes; each request
 * counts as use. Any session is refused from a revoked Device. Returns false
 * when refused, null for a session not made by PIN, else its Device.
 */
export async function checkDeviceSession(pool: Pool, sessionId: string, deviceToken: string | null | undefined): Promise<DeviceSession | null | false> {
  const tokenHash = deviceToken ? hash(deviceToken) : null;
  if (tokenHash && (await pool.query("select 1 from control.devices where token_hash = $1 and revoked_at is not null", [tokenHash])).rowCount) return false;
  const own = (await pool.query<{ device_id: string; property_id: string; matches: boolean; revoked: boolean; idle: boolean; must_change: boolean | null }>(
    `select d.id as device_id, d.property_id, d.token_hash = $2 as matches, d.revoked_at is not null as revoked,
       s.last_active_at < now() - make_interval(mins => s.idle_minutes) as idle,
       (select p.must_change from control.session x join control.user_pins p on p.user_id = x.user_id where x.id = s.session_id) as must_change
     from control.device_sessions s join control.devices d on d.id = s.device_id where s.session_id = $1`,
    [sessionId, tokenHash],
  )).rows[0];
  if (!own) return null;
  if (!own.matches || own.revoked) return false;
  if (own.idle) {
    await pool.query("delete from control.session where id = $1", [sessionId]);
    return false;
  }
  await pool.query("update control.device_sessions set last_active_at = now() where session_id = $1", [sessionId]);
  return { deviceId: own.device_id, propertyId: own.property_id, mustChange: own.must_change ?? false };
}

async function event(pool: Pool, e: { tenantId: string; userId: string; deviceId: string | null; kind: PinEventKind; byUserId?: string | null }) {
  await pool.query("insert into control.pin_events (tenant_id, user_id, device_id, kind, by_user_id) values ($1, $2, $3, $4, $5)", [e.tenantId, e.userId, e.deviceId, e.kind, e.byUserId ?? null]);
}

/** Set a user's PIN (a first PIN by someone else must be changed at first sign-in); unlocks the user. */
export async function setPin(
  hashPin: (pin: string) => Promise<string>,
  pool: Pool,
  input: { tenantId: string; userId: string; pin: string; byUserId: string; mustChange: boolean },
): Promise<void> {
  const problem = pinProblem(input.pin);
  if (problem === "format") throw new Error("A PIN has 4 to 6 digits");
  if (problem === "simple") throw new Error("That PIN is too simple; choose one without runs, repeats or a year");
  const member = (await pool.query("select 1 from control.\"user\" where id = $1 and tenant_id = $2", [input.userId, input.tenantId])).rows.length;
  if (!member) throw new Error("User not found");
  await pool.query(
    `insert into control.user_pins (user_id, pin_hash, failed_count, locked_at, must_change, updated_at) values ($1, $2, 0, null, $3, now())
     on conflict (user_id) do update set pin_hash = excluded.pin_hash, failed_count = 0, locked_at = null, must_change = excluded.must_change, updated_at = now()`,
    [input.userId, await hashPin(input.pin), input.mustChange],
  );
  await event(pool, { tenantId: input.tenantId, userId: input.userId, deviceId: null, kind: input.userId === input.byUserId ? "changed" : "reset", byUserId: input.byUserId });
}

/**
 * Choose one's own PIN, only while a first or reset PIN must be changed;
 * otherwise someone holding an unlocked Device could take the PIN over.
 */
export async function chooseOwnPin(hashPin: (pin: string) => Promise<string>, pool: Pool, input: { tenantId: string; userId: string; pin: string }): Promise<void> {
  const due = (await pool.query("select 1 from control.user_pins where user_id = $1 and must_change", [input.userId])).rowCount;
  if (!due) throw new Error("Ask your supervisor for a new PIN to change it");
  await setPin(hashPin, pool, { ...input, byUserId: input.userId, mustChange: false });
}

/** The PIN state of the tenant's users: who has one, who is locked. */
export async function pinStates(pool: Pool, tenantId: string): Promise<Map<string, { locked: boolean; mustChange: boolean }>> {
  const { rows } = await pool.query<{ user_id: string; locked: boolean; must_change: boolean }>(
    `select p.user_id, p.locked_at is not null as locked, p.must_change from control.user_pins p join control."user" u on u.id = p.user_id where u.tenant_id = $1`,
    [tenantId],
  );
  return new Map(rows.map((r) => [r.user_id, { locked: r.locked, mustChange: r.must_change }]));
}

export type PinEventKind = "success" | "wrong" | "lock" | "reset" | "changed";

/** PIN events of these users other than sign-ins (wrong PINs, lockouts, new PINs), newest first. */
export async function pinEvents(pool: Pool, tenantId: string, userIds: string[]): Promise<{ userId: string; deviceId: string | null; kind: Exclude<PinEventKind, "success">; byUserId: string | null; at: Date }[]> {
  const { rows } = await pool.query<{ user_id: string; device_id: string | null; kind: Exclude<PinEventKind, "success">; by_user_id: string | null; at: Date }>(
    "select user_id, device_id, kind, by_user_id, at from control.pin_events where tenant_id = $1 and user_id = any($2::text[]) and kind <> 'success' order by at desc limit 50",
    [tenantId, userIds],
  );
  return rows.map((r) => ({ userId: r.user_id, deviceId: r.device_id, kind: r.kind, byUserId: r.by_user_id, at: r.at }));
}

/** One cookie's value from the request headers. */
export const cookieValue = (headers: Headers | undefined, name: string): string | null =>
  headers
    ?.get("cookie")
    ?.split(";")
    .map((c) => c.trim().split("="))
    .find(([k]) => k === name)?.[1] ?? null;

/**
 * The PIN Sign-in endpoint (POST /api/auth/device/pin-sign-in, body
 * { userId, pin }): only with an enrolled, unrevoked staff Device's token,
 * for a user allowed on it whose roles are floor roles only. A new sign-in
 * ends the Device's previous session.
 */
export function devicePinPlugin(pool: Pool, appDomain: string) {
  return {
    id: "device-pin",
    endpoints: {
      devicePinSignIn: createAuthEndpoint("/device/pin-sign-in", { method: "POST" }, async (ctx) => {
        const body = (ctx.body ?? {}) as { userId?: unknown; pin?: unknown };
        const userId = String(body.userId ?? "");
        const pin = String(body.pin ?? "");
        const slug = ctx.headers ? resolveTenantSlugFromHeaders(ctx.headers, appDomain) : null;
        const tenant = slug ? await findTenantBySlug(pool, slug) : null;
        const device = await deviceByToken(pool, cookieValue(ctx.headers, DEVICE_COOKIE));
        if (!tenant || !device || device.tenantId !== tenant.id) throw new APIError("FORBIDDEN", { message: "PIN Sign-in works only on an enrolled Device" });
        if (device.revoked) throw new APIError("FORBIDDEN", { message: "This Device was revoked; its data is wiped" });
        if (device.kind !== "staff") throw new APIError("FORBIDDEN", { message: "Not a staff Device" });
        if (!device.userIds.includes(userId)) throw new APIError("FORBIDDEN", { message: "This user may not sign in on this Device" });
        const actor = await loadActor(pool, tenant.id, userId);
        if (!canUsePin(actor, device.propertyId)) throw new APIError("FORBIDDEN", { message: "Your role signs in with username and password" });
        // Take a try before checking, in one statement, so parallel guesses cannot exceed the limit.
        const row = (await pool.query<{ pin_hash: string; tries: number; must_change: boolean }>(
          "update control.user_pins set failed_count = failed_count + 1 where user_id = $1 and locked_at is null returning pin_hash, failed_count as tries, must_change",
          [userId],
        )).rows[0];
        if (!row) {
          const known = (await pool.query("select 1 from control.user_pins where user_id = $1", [userId])).rowCount;
          throw new APIError("FORBIDDEN", { message: known ? LOCKED : "No PIN set yet; ask your supervisor" });
        }
        const ok = row.tries <= PIN_MAX_TRIES && (await ctx.context.password.verify({ hash: row.pin_hash, password: pin }));
        if (!ok) {
          const lock = row.tries >= PIN_MAX_TRIES;
          if (lock) await pool.query("update control.user_pins set locked_at = now() where user_id = $1 and locked_at is null", [userId]);
          await event(pool, { tenantId: tenant.id, userId, deviceId: device.id, kind: lock ? "lock" : "wrong" });
          throw new APIError("UNAUTHORIZED", { message: lock ? LOCKED : `Wrong PIN (${PIN_MAX_TRIES - row.tries} tries left)` });
        }
        await pool.query("update control.user_pins set failed_count = 0 where user_id = $1", [userId]);
        // one person at a time on a Device: the previous session ends
        await endDeviceSessions(pool, device.id);
        const session = await ctx.context.internalAdapter.createSession(userId);
        const user = await ctx.context.internalAdapter.findUserById(userId);
        if (!session || !user) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Could not sign in" });
        const property = await findProperty(pool, tenant.schemaName, device.propertyId);
        await pool.query("insert into control.device_sessions (session_id, device_id, idle_minutes) values ($1, $2, $3)", [session.id, device.id, deviceIdleMinutes(property?.deviceIdleMinutes)]);
        await pool.query("update control.devices set last_user_id = $2, last_seen_at = now() where id = $1", [device.id, userId]);
        await event(pool, { tenantId: tenant.id, userId, deviceId: device.id, kind: "success" });
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ ok: true, mustChange: row.must_change });
      }),
    },
  } satisfies BetterAuthPlugin;
}

/** The people who may sign in on a Device, for its lock screen: name and id only. */
export async function deviceSignInList(pool: Pool, device: DeviceInfo): Promise<{ id: string; name: string }[]> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    'select id, name from control."user" where tenant_id = $1 and id = any($2::text[]) order by name',
    [device.tenantId, device.userIds],
  );
  return rows;
}
