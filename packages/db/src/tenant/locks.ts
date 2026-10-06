import type { Pool, PoolClient } from "pg";
import { KEY_HANDOVERS, automaticKeyKind, bridgeOnline, can, doorPin, guestHandover, handoverSupported, keyActions, keyPlan, keyValidUntil, type KeyHandover, type KeyKind, type LockCapabilities, type PlannedKey, type RevokeReason } from "@hoteloftware/domain";
import { LOCK_CAPABILITIES, LOCK_SYSTEMS, LockUnavailable, hasPlugin, lockPlugin, sealLockSecret, unsealLockSecret, type LockPlugin, type LockSystem } from "@hoteloftware/locks";
import { isUuid } from "./catalogue-common";
import type { Viewer } from "./room-state";
import { bridgeLockPlugin } from "./site-bridge";
import { reservationByKey } from "./portal";
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
  /** The platform's lock secret the lock system's credential and door PINs are sealed with. */
  sealKey: string;
  /** The plugin of a lock system (tests pass their own). */
  pluginFor?: (system: string, secret: string | null) => LockPlugin | null;
  /** How long a Site Bridge has to answer a lock command. */
  bridgeTimeoutMs?: number;
}

const SYNC_BY = "lock-sync";
const seal = (deps: LockDeps, plain: string) => sealLockSecret(deps.sealKey, plain);
/** What is sealed, or null where the lock secret changed since (the credential is entered again, PINs are reissued). */
const unseal = (deps: LockDeps, sealed: string): string | null => {
  try {
    return unsealLockSecret(deps.sealKey, sealed);
  } catch {
    return null;
  }
};

interface Settings {
  system: LockSystem;
  otherName: string;
  handover: KeyHandover;
  graceMinutes: number;
  secretSealed: string | null;
  /** A lock system on the hotel's network: the Site Bridge's plugin for it, the Bridge carrying it and what the plugin reports it can do. */
  bridgePlugin: string;
  bridge: { id: string; online: boolean; capabilities: LockCapabilities | null } | null;
}

/** A page waits this long at most for a Site Bridge. */
const PAGE_BRIDGE_TIMEOUT_MS = 4000;

async function settingsIn(tx: PoolClient, propertyId: string): Promise<Settings> {
  const r = (await tx.query<{ system: LockSystem; other_name: string; handover: KeyHandover; grace_minutes: number; secret_sealed: string | null; bridge_plugin: string }>("select system, other_name, handover, grace_minutes, secret_sealed, bridge_plugin from property_locks where property_id = $1", [propertyId])).rows[0];
  if (!r) return { system: "none", otherName: "", handover: "reception", graceMinutes: 60, secretSealed: null, bridgePlugin: "", bridge: null };
  let bridge: Settings["bridge"] = null;
  if (r.system === "bridge" && r.bridge_plugin) {
    const b = (await tx.query<{ id: string; last_seen_at: Date | null; plugins: { name: string; capabilities: LockCapabilities | null }[] }>("select id, last_seen_at, plugins from site_bridges where property_id = $1 and revoked_at is null order by last_seen_at desc nulls last", [propertyId])).rows.find((x) => x.plugins.some((p) => p.name === r.bridge_plugin));
    if (b) bridge = { id: b.id, online: bridgeOnline(b.last_seen_at, new Date()), capabilities: b.plugins.find((p) => p.name === r.bridge_plugin)!.capabilities };
  }
  return { system: r.system, otherName: r.other_name, handover: r.handover, graceMinutes: r.grace_minutes, secretSealed: r.secret_sealed, bridgePlugin: r.bridge_plugin, bridge };
}

const capabilitiesOf = (s: Settings): LockCapabilities | null => (hasPlugin(s.system) ? LOCK_CAPABILITIES[s.system] : s.system === "bridge" ? (s.bridge?.capabilities ?? null) : null);

function offlineBridge(name: string, capabilities: LockCapabilities): LockPlugin {
  const away = async (): Promise<never> => {
    throw new LockUnavailable("The Site Bridge is not reachable");
  };
  return { name: `bridge:${name}`, capabilities, issueKey: away, updateKey: away, revokeKey: away, revokeByKeyId: away, readCard: away, listEncoders: away, health: async () => ({ ok: false, detail: "Site Bridge not reachable" }) };
}

/** The plugin of the property's lock system: in this process, or on the Site Bridge (each call a command it answers). */
function pluginOf(s: Settings, deps: LockDeps, pool: Pool, schema: string): LockPlugin | null {
  if (s.system === "bridge") {
    const caps = capabilitiesOf(s);
    if (!s.bridge || !caps) return null;
    // a Bridge not calling in: every call fails at once instead of waiting for it (the sync tries again later)
    if (!s.bridge.online) return offlineBridge(s.bridgePlugin, caps);
    return bridgeLockPlugin(pool, schema, s.bridge.id, s.bridgePlugin, caps, deps.bridgeTimeoutMs);
  }
  const secret = s.secretSealed ? unseal(deps, s.secretSealed) : null;
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
  /** On the hotel's network: the Site Bridge's plugin for it. */
  bridgePlugin?: string | undefined;
}

export async function saveLockSettings(pool: Pool, schema: string, propertyId: string, input: LockSettingsInput, viewer: Viewer, deps: LockDeps): Promise<void> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  need(viewer, "manage_property_settings", propertyId);
  if (!(LOCK_SYSTEMS as readonly string[]).includes(input.system)) throw new Error("Choose the lock system");
  if (!(KEY_HANDOVERS as readonly string[]).includes(input.handover)) throw new Error("Choose how keys are handed over");
  if (!Number.isInteger(input.graceMinutes) || input.graceMinutes < 0 || input.graceMinutes > 720) throw new Error("The grace is 0 to 720 minutes");
  const otherName = input.system === "other" ? input.otherName.trim().slice(0, 60) : "";
  if (input.system === "other" && !otherName) throw new Error("Name the lock system");
  const bridgePlugin = input.system === "bridge" ? (input.bridgePlugin ?? "").trim() : "";
  if (input.system === "bridge" && !/^[a-z0-9-]{2,40}$/.test(bridgePlugin)) throw new Error("Choose the Site Bridge's plugin for the lock system");
  // a Bridge plugin: what it reported it can do (unknown until it ran once: checked again then)
  const caps = hasPlugin(input.system)
    ? LOCK_CAPABILITIES[input.system]
    : input.system === "bridge"
      ? await withTenant(pool, schema, async (tx) => (await tx.query<{ c: LockCapabilities | null }>("select (p->'capabilities') as c from site_bridges b, jsonb_array_elements(b.plugins) p where b.property_id = $1 and b.revoked_at is null and p->>'name' = $2 limit 1", [propertyId, bridgePlugin])).rows[0]?.c ?? null)
      : null;
  if (caps && !handoverSupported(input.handover as KeyHandover, caps)) throw new Error("This lock system cannot hand keys over that way");
  const secret = input.secret?.trim() ? seal(deps, input.secret.trim()) : null;
  await withTenant(pool, schema, async (tx) => {
    await tx.query(
      `insert into property_locks (property_id, system, other_name, handover, grace_minutes, secret_sealed, bridge_plugin, updated_by) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (property_id) do update set system = excluded.system, other_name = excluded.other_name, handover = excluded.handover, grace_minutes = excluded.grace_minutes,
         secret_sealed = coalesce(excluded.secret_sealed, property_locks.secret_sealed), bridge_plugin = excluded.bridge_plugin, updated_at = clock_timestamp(), updated_by = excluded.updated_by`,
      [propertyId, input.system, otherName, input.handover, input.graceMinutes, secret, bridgePlugin, viewer.userId],
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
    // only a Device of this property, desk or kiosk
    const own = (await tx.query("select 1 from control.devices where id = $1 and property_id = $2 and revoked_at is null", [deviceId, propertyId])).rows.length;
    if (!own) throw new Error("Device not found at this property");
    const enc = encoderId.trim().slice(0, 100);
    if (!enc) await tx.query("delete from lock_encoders where device_id = $1 and property_id = $2", [deviceId, propertyId]);
    // the caller checked the Device is the property's; a mapping never moves to another property
    else await tx.query("insert into lock_encoders (device_id, property_id, encoder_id) values ($1, $2, $3) on conflict (device_id) do update set encoder_id = excluded.encoder_id where lock_encoders.property_id = excluded.property_id", [deviceId, propertyId, enc]);
  });
}

export interface LockSetup {
  system: LockSystem;
  bridgePlugin: string;
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
  const plugin = pluginOf(s, { ...deps, bridgeTimeoutMs: PAGE_BRIDGE_TIMEOUT_MS }, pool, schema);
  return {
    system: s.system,
    bridgePlugin: s.bridgePlugin,
    otherName: s.otherName,
    handover: s.handover,
    graceMinutes: s.graceMinutes,
    hasSecret: !!s.secretSealed,
    capabilities: capabilitiesOf(s),
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
    `select r.id, r.property_id, r.status, to_char(r.departure, 'YYYY-MM-DD') as departure, p.time_zone, to_char(coalesce(r.late_checkout, m.checkout_time, '11:00'), 'HH24:MI') as checkout, coalesce(g.last_name, '') as guest,
       -- the room of tonight (on the departure morning: of the last night); a night not yet assigned keeps the room before it
       (select a.room_id from room_assignments a where a.reservation_id = r.id
          and a.from_date <= least(coalesce(p.business_date, r.arrival), r.departure - 1)
        order by a.from_date desc limit 1) as room_id
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
  lock_ref: string;
  kind: KeyKind;
  status: PlannedKey["status"];
  valid_from: Date;
  valid_until: Date;
  external_id: string | null;
  pin_sealed: string | null;
  encoder_id: string | null;
  issued_at: Date;
}

const KEY_SELECT = "select id, room_id, lock_ref, kind, status, valid_from, valid_until, external_id, pin_sealed, encoder_id, issued_at from room_keys";

const doorOf = async (tx: PoolClient, roomId: string) => (await tx.query<{ lock_ref: string }>("select lock_ref from lock_doors where room_id = $1", [roomId])).rows[0]?.lock_ref ?? null;

/** One key issued at the lock system: recorded pending first, so a key made there is never lost on our side. */
async function issueKey(pool: Pool, schema: string, plugin: LockPlugin, stay: Stay, kind: KeyKind, roomId: string, deps: LockDeps, by: string, encoderId?: string): Promise<string> {
  const pin = kind === "pin" ? doorPin() : undefined;
  const pending = await withTenant(pool, schema, async (tx) => {
    const lockRef = await doorOf(tx, roomId);
    if (!lockRef) {
      // said once, not at every run
      const said = (await tx.query("select 1 from key_events where reservation_id = $1 and action = 'no_door' and detail->>'roomId' = $2", [stay.id, roomId])).rows.length;
      if (!said) await event(tx, stay.id, null, "no_door", { roomId }, by);
      return null;
    }
    const id = (await tx.query<{ id: string }>(
      "insert into room_keys (reservation_id, room_id, lock_ref, kind, pin_sealed, encoder_id, valid_from, valid_until, issued_by) values ($1, $2, $3, $4, $5, $6, clock_timestamp(), $7, $8) returning id",
      [stay.id, roomId, lockRef, kind, pin ? seal(deps, pin) : null, encoderId ?? null, stay.validUntil, by],
    )).rows[0]!.id;
    return { id, lockRef };
  });
  if (!pending) throw new Error("The room has no door at the lock system");
  let made: { externalId: string; guestKey?: string | undefined };
  try {
    made = await plugin.issueKey({ keyId: pending.id, lockRef: pending.lockRef, kind, validFrom: new Date(), validUntil: stay.validUntil, guestName: stay.guest, pin, encoderId });
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    // the key may exist at the lock all the same: taken back by its name; where that fails too, it stays pending and the next run cleans up
    const cleaned = await plugin.revokeByKeyId(pending.id, pending.lockRef).then(() => true, () => false);
    await withTenant(pool, schema, async (tx) => {
      await tx.query(`update room_keys set ${cleaned ? "status = 'failed', " : ""}error = $2 where id = $1 and status = 'pending'`, [pending.id, message]);
      await event(tx, stay.id, pending.id, "failed", { kind, roomId, error: message }, by);
    });
    throw err;
  }
  // revoked at the desk while it was being made: taken back at the lock at once
  const kept = await withTenant(pool, schema, async (tx) => {
    const r = await tx.query("update room_keys set status = 'active', external_id = $2, guest_key_sealed = $3 where id = $1 and status = 'pending'", [pending.id, made.externalId, made.guestKey ? seal(deps, made.guestKey) : null]);
    if (r.rowCount) await event(tx, stay.id, pending.id, "issued", { kind, roomId, encoderId: encoderId ?? null }, by);
    else await tx.query("update room_keys set external_id = $2 where id = $1", [pending.id, made.externalId]);
    return !!r.rowCount;
  });
  if (!kept) await plugin.revokeKey(made.externalId, pending.lockRef);
  return pending.id;
}

async function revokeKey(pool: Pool, schema: string, plugin: LockPlugin, stay: Stay, k: KeyRow, reason: RevokeReason, by: string): Promise<void> {
  // an offline card cannot be taken back at the door: it runs to its written expiry
  if (plugin.capabilities.remoteRevoke || k.kind !== "card") {
    if (k.external_id) await plugin.revokeKey(k.external_id, k.lock_ref);
    else await plugin.revokeByKeyId(k.id, k.lock_ref);
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
    const keys = (await tx.query<KeyRow>(`${KEY_SELECT} where reservation_id = $1`, [reservationId])).rows;
    return stay ? { s, stay, keys } : null;
  });
  if (!loaded) return;
  const plugin = pluginOf(loaded.s, deps, pool, schema);
  if (!plugin) return;
  const { stay } = loaded;
  // a key left pending by an interrupted run: taken back at the lock by its name, then made again
  for (const k of loaded.keys.filter((x) => x.status === "pending" && !x.external_id && x.issued_at.getTime() < Date.now() - 120_000)) {
    await plugin.revokeByKeyId(k.id, k.lock_ref);
    await withTenant(pool, schema, (tx) => tx.query("update room_keys set status = 'failed', error = coalesce(error, 'interrupted') where id = $1 and status = 'pending'", [k.id]));
    k.status = "failed";
  }
  const keys = loaded.keys;
  const plan = keyPlan(stay, keys.map((k) => ({ id: k.id, roomId: k.room_id, kind: k.kind, status: k.status, validUntil: k.valid_until })), plugin.capabilities, automaticKeyKind(loaded.s.handover, plugin.capabilities));
  for (const r of plan.revoke) await revokeKey(pool, schema, plugin, stay, keys.find((k) => k.id === r.keyId)!, r.reason, SYNC_BY);
  for (const u of plan.update) {
    const k = keys.find((x) => x.id === u.keyId)!;
    const pin = (k.pin_sealed ? unseal(deps, k.pin_sealed) : null) ?? undefined;
    const renewed = k.external_id ? await plugin.updateKey(k.external_id, { keyId: k.id, lockRef: k.lock_ref, kind: k.kind, validFrom: k.valid_from, validUntil: u.validUntil, guestName: stay.guest, pin, encoderId: k.encoder_id ?? undefined }) : undefined;
    await withTenant(pool, schema, async (tx) => {
      // a Digital Key renewed by the lock system: the guest's phone gets the new one
      await tx.query("update room_keys set valid_until = $2, guest_key_sealed = coalesce($3, guest_key_sealed) where id = $1", [k.id, u.validUntil, renewed?.guestKey ? seal(deps, renewed.guestKey) : null]);
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
 * leases the stay and holds its lock, so two workers never run one stay at
 * once; a change while it runs clears the lease, and the stay runs again. A
 * lock system that does not answer is tried again with back-off; the first
 * failure is logged on the reservation.
 */
export async function syncLockKeys(pool: Pool, schema: string, deps: LockDeps, limit = 50): Promise<{ done: number; failed: number }> {
  const due = await withTenant(pool, schema, async (tx) => (await tx.query<{ reservation_id: string }>("select reservation_id from lock_sync where next_at <= clock_timestamp() order by next_at limit $1", [limit])).rows.map((r) => r.reservation_id));
  const out = { done: 0, failed: 0 };
  for (const id of due) {
    const c = await pool.connect();
    try {
      if (!(await c.query<{ ok: boolean }>("select pg_try_advisory_lock(hashtext($1)) as ok", [`${schema}:lock-sync:${id}`])).rows[0]!.ok) continue;
      try {
        const lease = await withTenant(pool, schema, async (tx) => (await tx.query<{ lease: string }>("update lock_sync set lease = gen_random_uuid(), next_at = clock_timestamp() + interval '5 minutes' where reservation_id = $1 and next_at <= clock_timestamp() returning lease", [id])).rows[0]?.lease ?? null);
        if (!lease) continue;
        try {
          await syncStay(pool, schema, id, deps);
          await withTenant(pool, schema, (tx) => tx.query("delete from lock_sync where reservation_id = $1 and lease = $2", [id, lease]));
          out.done++;
        } catch (err) {
          const message = (err instanceof Error ? err.message : String(err)).slice(0, 200);
          await withTenant(pool, schema, async (tx) => {
            const r = (await tx.query<{ attempts: number }>("update lock_sync set attempts = attempts + 1, next_at = clock_timestamp() + least(attempts + 1, 30) * interval '1 minute', error = $3 where reservation_id = $1 and lease = $2 returning attempts", [id, lease, message])).rows[0];
            if (r?.attempts === 1) await event(tx, id, null, "sync_failed", { error: message, retried: err instanceof LockUnavailable }, SYNC_BY);
          });
          out.failed++;
        }
      } finally {
        await c.query("select pg_advisory_unlock(hashtext($1))", [`${schema}:lock-sync:${id}`]);
      }
    } finally {
      c.release();
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
  const plugin = pluginOf(c.s, deps, pool, schema);
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

/** A late check-out agreed for the stay (null: the property's check-out time); its keys follow. */
export async function setLateCheckout(pool: Pool, schema: string, reservationId: string, time: string | null, viewer: Viewer): Promise<void> {
  if (!isUuid(reservationId)) throw new Error("Reservation not found");
  if (time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Choose a time");
  await withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<{ property_id: string; status: string }>("select property_id, status from reservations where id = $1 for update", [reservationId])).rows[0];
    if (!r) throw new Error("Reservation not found");
    need(viewer, "check_in", r.property_id);
    if (r.status !== "confirmed" && r.status !== "checked_in") throw new Error("The stay is over");
    await tx.query("update reservations set late_checkout = $2 where id = $1", [reservationId, time]);
    await event(tx, reservationId, null, "late_checkout", { time }, viewer.userId);
  });
}

// ── for the guest ──

/** How the property's guests get their key, as far as its lock system can (the Self Check-in's last screen). */
export async function guestKeyHandoverIn(tx: PoolClient, propertyId: string): Promise<KeyHandover> {
  const s = await settingsIn(tx, propertyId);
  return guestHandover(s.handover, capabilitiesOf(s));
}

export interface GuestKeys {
  handover: KeyHandover;
  /** The stay's door PINs and Digital Keys in force (none before check-in, none after check-out). */
  keys: { kind: "pin" | "phone"; room: string; validUntil: string; pin: string | null; guestKey: string | null }[];
}

/** The keys the guest holds, for the Guest Portal and the Self Check-in: only while the stay is Checked-in. */
export async function guestKeys(pool: Pool, schema: string, portalKey: string, deps: LockDeps, onlyAt?: string): Promise<GuestKeys | null> {
  return withTenant(pool, schema, async (tx) => {
    // the Portal Link's own check: a closed link opens nothing
    const r = await reservationByKey(tx, portalKey).catch(() => null);
    // a kiosk serves its own property only
    if (!r || (onlyAt && r.property_id !== onlyAt)) return null;
    const handover = await guestKeyHandoverIn(tx, r.property_id);
    if (r.status !== "checked_in") return { handover, keys: [] };
    const keys = (await tx.query<{ kind: "pin" | "phone"; number: string; valid_until: Date; pin_sealed: string | null; guest_key_sealed: string | null }>(
      "select k.kind, m.number, k.valid_until, k.pin_sealed, k.guest_key_sealed from room_keys k join rooms m on m.id = k.room_id where k.reservation_id = $1 and k.status = 'active' and k.kind in ('pin', 'phone') and k.valid_until > clock_timestamp() order by k.issued_at",
      [r.id],
    )).rows;
    return {
      handover,
      keys: keys.map((k) => ({ kind: k.kind, room: k.number, validUntil: k.valid_until.toISOString(), pin: k.pin_sealed ? unseal(deps, k.pin_sealed) : null, guestKey: k.guest_key_sealed ? unseal(deps, k.guest_key_sealed) : null })),
    };
  });
}

/**
 * The kiosk writes the checked-in guest's key card on the encoder set for
 * that kiosk Device (handover "kiosk encoder"). A second tap within a
 * minute gets the card already written; later, a new card (a jammed one,
 * a second guest of the room).
 */
export async function issueKioskCard(pool: Pool, schema: string, portalKey: string, kiosk: { deviceId: string; propertyId: string }, deps: LockDeps): Promise<{ room: string }> {
  if (!isUuid(kiosk.deviceId)) throw new Error("Not found");
  // two taps at once: one waits for the other and gets its card
  const lock = await pool.connect();
  try {
    await lock.query("select pg_advisory_lock(hashtext($1))", [`${schema}:kiosk-card:${portalKey}`]);
    return await kioskCardLocked(pool, schema, portalKey, kiosk, deps);
  } finally {
    await lock.query("select pg_advisory_unlock(hashtext($1))", [`${schema}:kiosk-card:${portalKey}`]).catch(() => undefined);
    lock.release();
  }
}

async function kioskCardLocked(pool: Pool, schema: string, portalKey: string, kiosk: { deviceId: string; propertyId: string }, deps: LockDeps): Promise<{ room: string }> {
  const c = await withTenant(pool, schema, async (tx) => {
    const r = await reservationByKey(tx, portalKey).catch(() => null);
    if (!r || r.property_id !== kiosk.propertyId) throw new Error("Not found");
    if (r.status !== "checked_in") throw new Error("Keys are made for checked-in guests only");
    // only right after this stay's Self Check-in finished on this very kiosk: a Portal Link alone makes no cards
    const here = (await tx.query("select 1 from self_checkins where reservation_id = $1 and device_id = $2 and outcome = 'checked_in' and finished_at > clock_timestamp() - interval '15 minutes'", [r.id, kiosk.deviceId])).rows.length;
    if (!here) throw new Error("Keys are collected at reception");
    const s = await settingsIn(tx, r.property_id);
    if ((await guestKeyHandoverIn(tx, r.property_id)) !== "kiosk_encoder") throw new Error("Keys are collected at reception");
    const encoder = (await tx.query<{ encoder_id: string }>("select encoder_id from lock_encoders where device_id = $1 and property_id = $2", [kiosk.deviceId, r.property_id])).rows[0]?.encoder_id;
    if (!encoder) throw new Error("This kiosk has no encoder");
    const stay = (await stayIn(tx, r.id, s))!;
    const room = stay.roomId ? (await tx.query<{ number: string }>("select number from rooms where id = $1", [stay.roomId])).rows[0]!.number : null;
    const recent = (await tx.query("select 1 from room_keys where reservation_id = $1 and kind = 'card' and encoder_id = $2 and status in ('pending', 'active') and issued_at > clock_timestamp() - interval '1 minute'", [r.id, encoder])).rows.length > 0;
    return { s, stay, room, encoder, recent };
  });
  if (!c.room || !c.stay.roomId) throw new Error("No room yet");
  if (c.recent) return { room: c.room };
  const plugin = pluginOf(c.s, deps, pool, schema);
  if (!plugin) throw new Error("No lock system is connected");
  await issueKey(pool, schema, plugin, c.stay, "card", c.stay.roomId, deps, `kiosk:${kiosk.deviceId}`, c.encoder);
  return { room: c.room };
}

/** A lost key taken back. */
export async function revokeRoomKey(pool: Pool, schema: string, keyId: string, viewer: Viewer, deps: LockDeps): Promise<void> {
  if (!isUuid(keyId)) throw new Error("Key not found");
  const k = await withTenant(pool, schema, async (tx) => (await tx.query<KeyRow & { reservation_id: string }>(`${KEY_SELECT.replace("select id", "select reservation_id, id")} where id = $1`, [keyId])).rows[0]);
  if (!k) throw new Error("Key not found");
  const { stay, plugin } = await deskContext(pool, schema, k.reservation_id, viewer, deps);
  if (k.status === "pending") throw new Error("The key is still being made; try again in a moment");
  if (k.status !== "active") throw new Error("The key is not in use");
  await revokeKey(pool, schema, plugin, stay, k, "lost", viewer.userId);
  // a lost door PIN or Digital Key is replaced by the next run
  await withTenant(pool, schema, (tx) => tx.query("select queue_lock_sync($1)", [stay.id]));
  if (k.kind === "card" && !plugin.capabilities.remoteRevoke) await withTenant(pool, schema, (tx) => event(tx, stay.id, k.id, "warning", { warning: "offline_card_runs_to_expiry" }, viewer.userId));
}

/** A key card laid on an encoder: whose it is and until when. */
export async function readKeyCard(pool: Pool, schema: string, propertyId: string, encoderId: string, viewer: Viewer, deps: LockDeps): Promise<{ room: string | null; reservationId: string | null; guest: string | null; validUntil: string; status: string | null } | null> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  need(viewer, "check_in", propertyId);
  const s = await withTenant(pool, schema, (tx) => settingsIn(tx, propertyId));
  const plugin = pluginOf(s, deps, pool, schema);
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
  /** A late check-out agreed for the stay (HH:MM). */
  lateCheckout: string | null;
  /** Who checks guests in may change keys and the late check-out. */
  desk: boolean;
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
      "select k.id, k.room_id, k.lock_ref, k.kind, k.status, k.valid_from, k.valid_until, k.external_id, k.pin_sealed, k.encoder_id, k.issued_at, m.number, k.revoke_reason, k.error from room_keys k join rooms m on m.id = k.room_id where k.reservation_id = $1 order by k.issued_at",
      [reservationId],
    )).rows;
    const events = (await tx.query<{ at: Date; action: string; detail: Record<string, unknown>; by: string }>("select at, action, detail, by from key_events where reservation_id = $1 order by at, id", [reservationId])).rows;
    const caps = capabilitiesOf(s);
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
        pin: desk && k.pin_sealed && k.status === "active" ? unseal(deps, k.pin_sealed) : null,
        revokeReason: k.revoke_reason,
        error: k.error,
      })),
      events: events.map((e) => ({ at: e.at.toISOString(), action: e.action, detail: e.detail, by: e.by })),
      deskEncoder,
      lateCheckout: (await tx.query<{ t: string | null }>("select to_char(late_checkout, 'HH24:MI') as t from reservations where id = $1", [reservationId])).rows[0]!.t,
      desk,
      settings: s,
    };
  });
  if (!view) return null;
  const { settings, ...rest } = view;
  // a page waits a few seconds at most for a Site Bridge
  const plugin = rest.actions.issueCard || rest.actions.readCard ? pluginOf(settings, { ...deps, bridgeTimeoutMs: PAGE_BRIDGE_TIMEOUT_MS }, pool, schema) : null;
  return { ...rest, encoders: plugin ? await plugin.listEncoders().catch(() => []) : [] };
}
