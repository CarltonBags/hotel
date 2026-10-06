import type { Pool, PoolClient } from "pg";
import { KEY_HANDOVERS, automaticKeyKind, can, doorPin, keyActions, keyPlan, keyValidUntil, type KeyHandover, type KeyKind, type LockCapabilities, type PlannedKey, type RevokeReason } from "@hoteloftware/domain";
import { seal, unseal } from "@hoteloftware/fiscal";
import { LOCK_CAPABILITIES, LOCK_SYSTEMS, lockPlugin, type LockPlugin, type LockSystem } from "@hoteloftware/locks";
import { isUuid } from "./catalogue-common";
import type { Viewer } from "./room-state";
import { withTenant } from "./with-tenant";

/**
 * Door locks and keys (ticket 67). The property sets its lock system and how
 * keys are handed over; a key exists only for a Checked-in stay and runs to
 * check-out time plus the grace. Whatever changes a stay (check-in,
 * extension, room move, check-out, no-show, cancellation) queues it, and the
 * worker brings its keys in line through the lock system's plugin. The desk
 * writes key cards on its encoder and revokes lost keys. Every key event is
 * logged on the reservation.
 */

export interface LockDeps {
  /** The platform secret the lock system's credential and door PINs are sealed with. */
  sealKey: string;
  /** The plugin of a lock system (tests pass their own). */
  pluginFor?: (system: string, secret: string | null) => LockPlugin | null;
}

const SYNC_BY = "lock-sync";
const sealed = (deps: LockDeps) => `${deps.sealKey}:locks`;

interface Settings {
  system: LockSystem;
  otherName: string;
  handover: KeyHandover;
  graceMinutes: number;
  secretSealed: string | null;
}

async function settingsIn(tx: PoolClient, propertyId: string): Promise<Settings> {
  const r = (await tx.query<{ system: LockSystem; other_name: string; handover: KeyHandover; grace_minutes: number; secret_sealed: string | null }>("select system, other_name, handover, grace_minutes, secret_sealed from property_locks where property_id = $1", [propertyId])).rows[0];
  return r ? { system: r.system, otherName: r.other_name, handover: r.handover, graceMinutes: r.grace_minutes, secretSealed: r.secret_sealed } : { system: "none", otherName: "", handover: "reception", graceMinutes: 60, secretSealed: null };
}

const capabilitiesOf = (system: LockSystem): LockCapabilities | null => (system === "simulated" || system === "nuki" ? LOCK_CAPABILITIES[system] : null);

function pluginOf(s: Settings, deps: LockDeps): LockPlugin | null {
  const secret = s.secretSealed ? unseal(sealed(deps), s.secretSealed) : null;
  return (deps.pluginFor ?? lockPlugin)(s.system, secret);
}

function need(viewer: Viewer, action: "check_in" | "manage_property_settings" | "view_reservations", propertyId: string): void {
  if (!can(viewer.actor, action, propertyId)) throw new Error("Not allowed");
}

async function event(tx: PoolClient, reservationId: string, keyId: string | null, action: string, detail: Record<string, unknown>, by: string): Promise<void> {
  await tx.query("insert into key_events (reservation_id, room_key_id, action, detail, by) values ($1, $2, $3, $4, $5)", [reservationId, keyId, action, JSON.stringify(detail), by]);
}

// ── setup ──

export interface LockSettingsInput {
  system: string;
  otherName: string;
  handover: string;
  graceMinutes: number;
  /** The lock system's credential; null keeps the one stored. */
  secret: string | null;
}

export async function saveLockSettings(pool: Pool, schema: string, propertyId: string, input: LockSettingsInput, viewer: Viewer, deps: LockDeps): Promise<void> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  need(viewer, "manage_property_settings", propertyId);
  if (!(LOCK_SYSTEMS as readonly string[]).includes(input.system)) throw new Error("Choose the lock system");
  if (!(KEY_HANDOVERS as readonly string[]).includes(input.handover)) throw new Error("Choose how keys are handed over");
  if (!Number.isInteger(input.graceMinutes) || input.graceMinutes < 0 || input.graceMinutes > 720) throw new Error("The grace is 0 to 720 minutes");
  const otherName = input.system === "other" ? input.otherName.trim().slice(0, 60) : "";
  if (input.system === "other" && !otherName) throw new Error("Name the lock system");
  const secret = input.secret?.trim() ? seal(sealed(deps), input.secret.trim()) : null;
  await withTenant(pool, schema, async (tx) => {
    await tx.query(
      `insert into property_locks (property_id, system, other_name, handover, grace_minutes, secret_sealed, updated_by) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (property_id) do update set system = excluded.system, other_name = excluded.other_name, handover = excluded.handover, grace_minutes = excluded.grace_minutes,
         secret_sealed = coalesce(excluded.secret_sealed, property_locks.secret_sealed), updated_at = clock_timestamp(), updated_by = excluded.updated_by`,
      [propertyId, input.system, otherName, input.handover, input.graceMinutes, secret, viewer.userId],
    );
    // the stays in house now follow the new setting
    await tx.query("select queue_lock_sync(id) from reservations where property_id = $1 and status = 'checked_in'", [propertyId]);
  });
}

/** A room's door at the lock system; empty removes it. */
export async function setLockDoor(pool: Pool, schema: string, roomId: string, lockRef: string, viewer: Viewer): Promise<void> {
  if (!isUuid(roomId)) throw new Error("Room not found");
  await withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<{ property_id: string }>("select property_id from rooms where id = $1", [roomId])).rows[0];
    if (!r) throw new Error("Room not found");
    need(viewer, "manage_property_settings", r.property_id);
    const ref = lockRef.trim().slice(0, 100);
    if (!ref) await tx.query("delete from lock_doors where room_id = $1", [roomId]);
    else await tx.query("insert into lock_doors (room_id, lock_ref) values ($1, $2) on conflict (room_id) do update set lock_ref = excluded.lock_ref", [roomId, ref]);
  });
}

/** The encoder a desk workstation (an enrolled Device) writes key cards on; empty removes it. */
export async function setDeskEncoder(pool: Pool, schema: string, propertyId: string, deviceId: string, encoderId: string, viewer: Viewer): Promise<void> {
  if (!isUuid(propertyId) || !isUuid(deviceId)) throw new Error("Device not found");
  need(viewer, "manage_property_settings", propertyId);
  await withTenant(pool, schema, async (tx) => {
    const enc = encoderId.trim().slice(0, 100);
    if (!enc) await tx.query("delete from lock_encoders where device_id = $1 and property_id = $2", [deviceId, propertyId]);
    else await tx.query("insert into lock_encoders (device_id, property_id, encoder_id) values ($1, $2, $3) on conflict (device_id) do update set property_id = excluded.property_id, encoder_id = excluded.encoder_id", [deviceId, propertyId, enc]);
  });
}

export interface LockSetup {
  system: LockSystem;
  otherName: string;
  handover: KeyHandover;
  graceMinutes: number;
  hasSecret: boolean;
  capabilities: LockCapabilities | null;
  doors: { roomId: string; number: string; lockRef: string }[];
  deskEncoders: Record<string, string>;
  encoders: { id: string; name: string }[];
  health: { ok: boolean; detail: string } | null;
}

export async function lockSetup(pool: Pool, schema: string, propertyId: string, viewer: Viewer, deps: LockDeps): Promise<LockSetup> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  need(viewer, "manage_property_settings", propertyId);
  const { s, doors, deskEncoders } = await withTenant(pool, schema, async (tx) => ({
    s: await settingsIn(tx, propertyId),
    doors: (await tx.query<{ room_id: string; number: string; lock_ref: string | null }>("select r.id as room_id, r.number, d.lock_ref from rooms r left join lock_doors d on d.room_id = r.id where r.property_id = $1 order by r.number", [propertyId])).rows,
    deskEncoders: Object.fromEntries((await tx.query<{ device_id: string; encoder_id: string }>("select device_id, encoder_id from lock_encoders where property_id = $1", [propertyId])).rows.map((r) => [r.device_id, r.encoder_id])),
  }));
  const plugin = pluginOf(s, deps);
  return {
    system: s.system,
    otherName: s.otherName,
    handover: s.handover,
    graceMinutes: s.graceMinutes,
    hasSecret: !!s.secretSealed,
    capabilities: capabilitiesOf(s.system),
    doors: doors.map((d) => ({ roomId: d.room_id, number: d.number, lockRef: d.lock_ref ?? "" })),
    deskEncoders,
    encoders: plugin ? await plugin.listEncoders().catch(() => []) : [],
    health: plugin ? await plugin.health().catch((err: unknown) => ({ ok: false, detail: err instanceof Error ? err.message : "not reachable" })) : null,
  };
}

// ── a stay's keys ──

interface Stay {
  id: string;
  propertyId: string;
  status: string;
  roomId: string | null;
  validUntil: Date;
  guest: string;
}

async function stayIn(tx: PoolClient, reservationId: string, s: Settings): Promise<Stay | null> {
  const r = (await tx.query<{ id: string; property_id: string; status: string; departure: string; time_zone: string; checkout: string; guest: string; room_id: string | null }>(
    `select r.id, r.property_id, r.status, to_char(r.departure, 'YYYY-MM-DD') as departure, p.time_zone, to_char(coalesce(m.checkout_time, '11:00'), 'HH24:MI') as checkout, coalesce(g.last_name, '') as guest,
       (select a.room_id from room_assignments a where a.reservation_id = r.id and a.from_date <= coalesce(p.business_date, r.arrival) and a.to_date > coalesce(p.business_date, r.arrival) order by a.from_date desc limit 1) as room_id
     from reservations r join properties p on p.id = r.property_id left join property_messaging m on m.property_id = p.id left join guests g on g.id = r.primary_guest_id
     where r.id = $1`,
    [reservationId],
  )).rows[0];
  if (!r) return null;
  return { id: r.id, propertyId: r.property_id, status: r.status, roomId: r.room_id, validUntil: keyValidUntil(r.departure, r.checkout, s.graceMinutes, r.time_zone), guest: r.guest };
}

interface KeyRow {
  id: string;
  room_id: string;
  kind: KeyKind;
  status: PlannedKey["status"];
  valid_from: Date;
  valid_until: Date;
  external_id: string | null;
  pin_sealed: string | null;
  encoder_id: string | null;
}

const KEY_SELECT = "select id, room_id, kind, status, valid_from, valid_until, external_id, pin_sealed, encoder_id from room_keys";

const doorOf = async (tx: PoolClient, roomId: string) => (await tx.query<{ lock_ref: string }>("select lock_ref from lock_doors where room_id = $1", [roomId])).rows[0]?.lock_ref ?? null;

/** One key issued at the lock system: recorded pending first, so a key made there is never lost on our side. */
async function issueKey(pool: Pool, schema: string, plugin: LockPlugin, stay: Stay, kind: KeyKind, roomId: string, deps: LockDeps, by: string, encoderId?: string): Promise<string> {
  const pin = kind === "pin" ? doorPin() : undefined;
  const pending = await withTenant(pool, schema, async (tx) => {
    const lockRef = await doorOf(tx, roomId);
    if (!lockRef) {
      await event(tx, stay.id, null, "no_door", { roomId }, by);
      return null;
    }
    const id = (await tx.query<{ id: string }>(
      "insert into room_keys (reservation_id, room_id, kind, pin_sealed, encoder_id, valid_from, valid_until, issued_by) values ($1, $2, $3, $4, $5, clock_timestamp(), $6, $7) returning id",
      [stay.id, roomId, kind, pin ? seal(sealed(deps), pin) : null, encoderId ?? null, stay.validUntil, by],
    )).rows[0]!.id;
    return { id, lockRef };
  });
  if (!pending) throw new Error("The room has no door at the lock system");
  try {
    const made = await plugin.issueKey({ keyId: pending.id, lockRef: pending.lockRef, kind, validFrom: new Date(), validUntil: stay.validUntil, guestName: stay.guest, pin, encoderId });
    await withTenant(pool, schema, async (tx) => {
      await tx.query("update room_keys set status = 'active', external_id = $2 where id = $1", [pending.id, made.externalId]);
      await event(tx, stay.id, pending.id, "issued", { kind, roomId, encoderId: encoderId ?? null }, by);
    });
    return pending.id;
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    await withTenant(pool, schema, async (tx) => {
      await tx.query("update room_keys set status = 'failed', error = $2 where id = $1", [pending.id, message]);
      await event(tx, stay.id, pending.id, "failed", { kind, roomId, error: message }, by);
    });
    throw err;
  }
}

async function revokeKey(pool: Pool, schema: string, plugin: LockPlugin, stay: Stay, k: KeyRow, reason: RevokeReason, by: string): Promise<void> {
  // an offline card cannot be taken back at the door: it runs to its written expiry
  if (k.external_id && (plugin.capabilities.remoteRevoke || k.kind !== "card")) {
    const lockRef = await withTenant(pool, schema, (tx) => doorOf(tx, k.room_id));
    if (lockRef) await plugin.revokeKey(k.external_id, lockRef);
  }
  await withTenant(pool, schema, async (tx) => {
    await tx.query("update room_keys set status = 'revoked', revoked_at = clock_timestamp(), revoked_by = $2, revoke_reason = $3 where id = $1 and status in ('pending', 'active')", [k.id, by, reason]);
    await event(tx, stay.id, k.id, "revoked", { reason, roomId: k.room_id }, by);
  });
}

/** Bring one stay's keys in line with where it stands. */
async function syncStay(pool: Pool, schema: string, reservationId: string, deps: LockDeps): Promise<void> {
  const loaded = await withTenant(pool, schema, async (tx) => {
    const propertyId = (await tx.query<{ property_id: string }>("select property_id from reservations where id = $1", [reservationId])).rows[0]?.property_id;
    if (!propertyId) return null;
    const s = await settingsIn(tx, propertyId);
    const stay = await stayIn(tx, reservationId, s);
    // a key left pending by an interrupted run is given up and made again
    await tx.query("update room_keys set status = 'failed', error = 'interrupted' where reservation_id = $1 and status = 'pending' and external_id is null and issued_at < clock_timestamp() - interval '2 minutes'", [reservationId]);
    const keys = (await tx.query<KeyRow>(`${KEY_SELECT} where reservation_id = $1`, [reservationId])).rows;
    return stay ? { s, stay, keys } : null;
  });
  if (!loaded) return;
  const plugin = pluginOf(loaded.s, deps);
  if (!plugin) return;
  const { stay, keys } = loaded;
  const plan = keyPlan(stay, keys.map((k) => ({ id: k.id, roomId: k.room_id, kind: k.kind, status: k.status, validUntil: k.valid_until })), plugin.capabilities, automaticKeyKind(loaded.s.handover, plugin.capabilities));
  for (const r of plan.revoke) await revokeKey(pool, schema, plugin, stay, keys.find((k) => k.id === r.keyId)!, r.reason, SYNC_BY);
  for (const u of plan.update) {
    const k = keys.find((x) => x.id === u.keyId)!;
    const pin = k.pin_sealed ? unseal(sealed(deps), k.pin_sealed) : undefined;
    const lockRef = await withTenant(pool, schema, (tx) => doorOf(tx, k.room_id));
    if (k.external_id && lockRef) await plugin.updateKey(k.external_id, { keyId: k.id, lockRef, kind: k.kind, validFrom: k.valid_from, validUntil: u.validUntil, guestName: stay.guest, pin, encoderId: k.encoder_id ?? undefined });
    await withTenant(pool, schema, async (tx) => {
      await tx.query("update room_keys set valid_until = $2 where id = $1", [k.id, u.validUntil]);
      await event(tx, stay.id, k.id, "updated", { validUntil: u.validUntil.toISOString() }, SYNC_BY);
    });
  }
  for (const i of plan.issue) await issueKey(pool, schema, plugin, stay, i.kind, i.roomId, deps, SYNC_BY);
  if (plan.warnings.length) await withTenant(pool, schema, async (tx) => {
    for (const w of plan.warnings) await event(tx, stay.id, null, "warning", { warning: w }, SYNC_BY);
  });
}

/**
 * The worker's run: every queued stay brought in line, one at a time. A run
 * leases the stay; a change while it runs queues it again. A lock system that
 * does not answer is tried again with back-off.
 */
export async function syncLockKeys(pool: Pool, schema: string, deps: LockDeps, limit = 50): Promise<{ done: number; failed: number }> {
  const due = await withTenant(pool, schema, async (tx) => (await tx.query<{ reservation_id: string }>("select reservation_id from lock_sync where next_at <= clock_timestamp() order by next_at limit $1", [limit])).rows.map((r) => r.reservation_id));
  const out = { done: 0, failed: 0 };
  for (const id of due) {
    const lease = await withTenant(pool, schema, async (tx) => (await tx.query<{ next_at: Date }>("update lock_sync set next_at = clock_timestamp() + interval '5 minutes' where reservation_id = $1 and next_at <= clock_timestamp() returning next_at", [id])).rows[0]?.next_at ?? null);
    if (!lease) continue;
    try {
      await syncStay(pool, schema, id, deps);
      await withTenant(pool, schema, (tx) => tx.query("delete from lock_sync where reservation_id = $1 and next_at = $2", [id, lease]));
      out.done++;
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      await withTenant(pool, schema, (tx) => tx.query("update lock_sync set attempts = attempts + 1, next_at = clock_timestamp() + least(attempts + 1, 30) * interval '1 minute', error = $3 where reservation_id = $1 and next_at = $2", [id, lease, message]));
      out.failed++;
    }
  }
  return out;
}

// ── at the desk ──

async function deskContext(pool: Pool, schema: string, reservationId: string, viewer: Viewer, deps: LockDeps) {
  if (!isUuid(reservationId)) throw new Error("Reservation not found");
  const c = await withTenant(pool, schema, async (tx) => {
    const propertyId = (await tx.query<{ property_id: string }>("select property_id from reservations where id = $1", [reservationId])).rows[0]?.property_id;
    if (!propertyId) throw new Error("Reservation not found");
    need(viewer, "check_in", propertyId);
    const s = await settingsIn(tx, propertyId);
    return { s, stay: (await stayIn(tx, reservationId, s))! };
  });
  const plugin = pluginOf(c.s, deps);
  if (!plugin) throw new Error(c.s.system === "other" ? "Keys are made in the lock system's own software" : "No lock system is connected");
  return { ...c, plugin };
}

/** The desk writes a key card for the stay's room on an encoder. Only for a Checked-in stay. */
export async function issueCardKey(pool: Pool, schema: string, reservationId: string, encoderId: string, viewer: Viewer, deps: LockDeps): Promise<string> {
  const { stay, plugin } = await deskContext(pool, schema, reservationId, viewer, deps);
  if (!keyActions(plugin.capabilities).issueCard) throw new Error("This lock system writes no key cards");
  if (stay.status !== "checked_in" || !stay.roomId) throw new Error("Keys are made for checked-in guests only");
  const enc = encoderId.trim();
  if (!enc) throw new Error("Choose the encoder");
  return issueKey(pool, schema, plugin, stay, "card", stay.roomId, deps, viewer.userId, enc);
}

/** A lost key taken back. */
export async function revokeRoomKey(pool: Pool, schema: string, keyId: string, viewer: Viewer, deps: LockDeps): Promise<void> {
  if (!isUuid(keyId)) throw new Error("Key not found");
  const k = await withTenant(pool, schema, async (tx) => (await tx.query<KeyRow & { reservation_id: string }>(`${KEY_SELECT.replace("select id", "select reservation_id, id")} where id = $1`, [keyId])).rows[0]);
  if (!k) throw new Error("Key not found");
  const { stay, plugin } = await deskContext(pool, schema, k.reservation_id, viewer, deps);
  if (k.status !== "active" && k.status !== "pending") throw new Error("The key is not in use");
  await revokeKey(pool, schema, plugin, stay, k, "lost", viewer.userId);
  if (k.kind === "card" && !plugin.capabilities.remoteRevoke) await withTenant(pool, schema, (tx) => event(tx, stay.id, k.id, "warning", { warning: "offline_card_runs_to_expiry" }, viewer.userId));
}

/** A key card laid on an encoder: whose it is and until when. */
export async function readKeyCard(pool: Pool, schema: string, propertyId: string, encoderId: string, viewer: Viewer, deps: LockDeps): Promise<{ room: string | null; reservationId: string | null; guest: string | null; validUntil: string; status: string | null } | null> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  need(viewer, "check_in", propertyId);
  const s = await withTenant(pool, schema, (tx) => settingsIn(tx, propertyId));
  const plugin = pluginOf(s, deps);
  if (!plugin?.capabilities.readCard) throw new Error("This lock system reads no cards");
  const card = await plugin.readCard(encoderId.trim());
  if (!card) return null;
  return withTenant(pool, schema, async (tx) => {
    const k = card.externalId
      ? (await tx.query<{ reservation_id: string; number: string; guest: string | null; status: string }>(
          "select k.reservation_id, m.number, g.last_name as guest, k.status from room_keys k join rooms m on m.id = k.room_id join reservations r on r.id = k.reservation_id left join guests g on g.id = r.primary_guest_id where k.external_id = $1 and r.property_id = $2",
          [card.externalId, propertyId],
        )).rows[0]
      : undefined;
    return { room: k?.number ?? null, reservationId: k?.reservation_id ?? null, guest: k?.guest ?? null, validUntil: card.validUntil.toISOString(), status: k?.status ?? null };
  });
}

export interface ReservationKeys {
  system: LockSystem;
  otherName: string;
  handover: KeyHandover;
  actions: ReturnType<typeof keyActions>;
  keys: { id: string; room: string; kind: KeyKind; status: string; validFrom: string; validUntil: string; pin: string | null; revokeReason: string | null; error: string | null }[];
  events: { at: string; action: string; detail: Record<string, unknown>; by: string }[];
  /** The desk Device's encoder, where set. */
  deskEncoder: string | null;
  /** The lock system's encoders, where the desk writes cards. */
  encoders: { id: string; name: string }[];
}

/** A stay's keys and their log, for its reservation page; door PINs only for who checks guests in. */
export async function reservationKeys(pool: Pool, schema: string, reservationId: string, viewer: Viewer, deps: LockDeps, deviceId?: string | null): Promise<ReservationKeys | null> {
  if (!isUuid(reservationId)) return null;
  const view = await withTenant(pool, schema, async (tx) => {
    const propertyId = (await tx.query<{ property_id: string }>("select property_id from reservations where id = $1", [reservationId])).rows[0]?.property_id;
    if (!propertyId || !can(viewer.actor, "view_reservations", propertyId)) return null;
    const s = await settingsIn(tx, propertyId);
    const desk = can(viewer.actor, "check_in", propertyId);
    const keys = (await tx.query<KeyRow & { number: string; revoke_reason: string | null; error: string | null }>(
      "select k.id, k.room_id, k.kind, k.status, k.valid_from, k.valid_until, k.external_id, k.pin_sealed, k.encoder_id, m.number, k.revoke_reason, k.error from room_keys k join rooms m on m.id = k.room_id where k.reservation_id = $1 order by k.issued_at",
      [reservationId],
    )).rows;
    const events = (await tx.query<{ at: Date; action: string; detail: Record<string, unknown>; by: string }>("select at, action, detail, by from key_events where reservation_id = $1 order by at, id", [reservationId])).rows;
    const caps = s.system === "nuki" && !s.secretSealed ? LOCK_CAPABILITIES.nuki : capabilitiesOf(s.system);
    const deskEncoder = deviceId && isUuid(deviceId) ? ((await tx.query<{ encoder_id: string }>("select encoder_id from lock_encoders where device_id = $1 and property_id = $2", [deviceId, propertyId])).rows[0]?.encoder_id ?? null) : null;
    return {
      system: s.system,
      otherName: s.otherName,
      handover: s.handover,
      actions: desk ? keyActions(caps) : keyActions(null),
      keys: keys.map((k) => ({
        id: k.id,
        room: k.number,
        kind: k.kind,
        status: k.status,
        validFrom: k.valid_from.toISOString(),
        validUntil: k.valid_until.toISOString(),
        pin: desk && k.pin_sealed && k.status === "active" ? unseal(sealed(deps), k.pin_sealed) : null,
        revokeReason: k.revoke_reason,
        error: k.error,
      })),
      events: events.map((e) => ({ at: e.at.toISOString(), action: e.action, detail: e.detail, by: e.by })),
      deskEncoder,
      settings: s,
    };
  });
  if (!view) return null;
  const { settings, ...rest } = view;
  const plugin = rest.actions.issueCard || rest.actions.readCard ? pluginOf(settings, deps) : null;
  return { ...rest, encoders: plugin ? await plugin.listEncoders().catch(() => []) : [] };
}
