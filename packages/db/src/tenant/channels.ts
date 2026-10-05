import type { Pool, PoolClient } from "pg";
import { FULL_PUSH_DAYS, addDays, channelRestriction, compressDays, type ChannelStatus } from "@hoteloftware/domain";
import { ChannelError, type AvailabilityValue, type ChannelManager, type RestrictionValue } from "@hoteloftware/channels";
import { loadPlanIndex } from "./rates";
import { loadQuoteData } from "./reservations";
import { withTenant } from "./with-tenant";

/**
 * The channel manager connection (ticket 37). Connecting projects the
 * property, its room types and each (rate plan, room type) pair sold on
 * channels; the mapping is kept up to date on every push. Changes reach the
 * ARI outbox through triggers in the same transaction; a push takes what is
 * waiting, works out the current values of those days and sends one
 * availability and one restrictions call, so a burst is coalesced and the
 * per-minute limit kept. Rows are marked sent only after the channel manager
 * took them: a restart loses nothing.
 */

export interface ChannelConnection {
  provider: string;
  externalId: string;
  connectedAt: Date;
  fullPushAt: Date | null;
  failingSince: Date | null;
  lastError: string | null;
}

export async function channelConnection(pool: Pool, schema: string, propertyId: string): Promise<ChannelConnection | null> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query("select provider, external_id, connected_at, full_push_at, failing_since, last_error from channel_connections where property_id = $1", [propertyId]);
    const r = rows[0];
    return r ? { provider: r.provider, externalId: r.external_id, connectedAt: r.connected_at, fullPushAt: r.full_push_at, failingSince: r.failing_since, lastError: r.last_error } : null;
  });
}

/** Connect a property: the property at the channel manager, its room types and rate plans, then everything pushed once. */
export async function connectChannels(pool: Pool, schema: string, propertyId: string, manager: ChannelManager, input: { email: string }, userId: string): Promise<void> {
  const property = await withTenant(pool, schema, async (tx) => {
    if ((await tx.query("select 1 from channel_connections where property_id = $1", [propertyId])).rows.length) throw new Error("This property is connected already");
    const { rows } = await tx.query<{ name: string; currency: string; time_zone: string }>("select name, currency, time_zone from properties where id = $1", [propertyId]);
    if (!rows[0]) throw new Error("Property not found");
    return rows[0];
  });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new Error("An email address for the channel manager is needed");
  const externalId = await manager.createProperty({ title: property.name, currency: property.currency, timezone: property.time_zone, email: input.email });
  await withTenant(pool, schema, (tx) => tx.query("insert into channel_connections (property_id, provider, external_id, connected_by) values ($1, $2, $3, $4)", [propertyId, manager.name, externalId, userId]));
  await syncChannelMappings(pool, schema, propertyId, manager);
  await withTenant(pool, schema, (tx) => enqueueFullPush(tx, propertyId));
}

/**
 * Keep the mapping: a room type or a pair sold on channels that has none yet
 * is created at the channel manager, and pushed in full; a changed room count
 * is sent.
 */
export async function syncChannelMappings(pool: Pool, schema: string, propertyId: string, manager: ChannelManager): Promise<number> {
  const state = await withTenant(pool, schema, async (tx) => {
    const conn = (await tx.query<{ external_id: string }>("select external_id from channel_connections where property_id = $1", [propertyId])).rows[0];
    if (!conn) return null;
    const { rows: types } = await tx.query<{ id: string; name: string; max_adults: number; max_occupancy: number; rooms: number; external_id: string | null; sent_rooms: number | null }>(
      `select t.id, t.name, t.max_adults, t.max_occupancy, (select count(*)::int from rooms r where r.room_type_id = t.id) as rooms, m.external_id, m.rooms as sent_rooms
       from room_types t left join channel_mappings m on m.room_type_id = t.id and m.rate_plan_id is null where t.property_id = $1 order by t.sort_order, t.code`,
      [propertyId],
    );
    const { rows: pairs } = await tx.query<{ plan_id: string; plan_name: string; base_occupancy: number; room_type_id: string; currency: string; mapped: boolean }>(
      `select p.id as plan_id, p.name as plan_name, p.base_occupancy, rt.room_type_id, pr.currency,
              exists (select 1 from channel_mappings m where m.rate_plan_id = p.id and m.room_type_id = rt.room_type_id) as mapped
       from rate_plans p join rate_plan_room_types rt on rt.rate_plan_id = p.id join properties pr on pr.id = p.property_id
       where p.property_id = $1 and p.active and p.sold_on_channels order by p.sort_order, p.code`,
      [propertyId],
    );
    return { externalId: conn.external_id, types, pairs };
  });
  if (!state) return 0;
  let created = 0;
  const typeExternal = new Map<string, string>();
  for (const t of state.types) {
    const roomType = { propertyId: state.externalId, title: t.name, rooms: t.rooms, maxAdults: t.max_adults, maxChildren: Math.max(0, t.max_occupancy - 1), defaultOccupancy: Math.min(2, t.max_adults) };
    if (!t.external_id) {
      const id = await manager.createRoomType(roomType);
      await withTenant(pool, schema, async (tx) => {
        await tx.query("insert into channel_mappings (property_id, room_type_id, external_id, rooms) values ($1, $2, $3, $4)", [propertyId, t.id, id, t.rooms]);
        await enqueueHorizon(tx, propertyId, "availability", t.id, null);
      });
      typeExternal.set(t.id, id);
      created++;
    } else {
      typeExternal.set(t.id, t.external_id);
      if (t.sent_rooms !== t.rooms) {
        await manager.updateRoomType(t.external_id, roomType);
        await withTenant(pool, schema, (tx) => tx.query("update channel_mappings set rooms = $2 where room_type_id = $1 and rate_plan_id is null", [t.id, t.rooms]));
      }
    }
  }
  for (const p of state.pairs) {
    if (p.mapped) continue;
    const type = state.types.find((t) => t.id === p.room_type_id)!;
    const id = await manager.createRatePlan({ propertyId: state.externalId, roomTypeId: typeExternal.get(p.room_type_id)!, title: `${p.plan_name} · ${type.name}`, currency: p.currency, primaryOccupancy: p.base_occupancy, maxAdults: type.max_adults });
    await withTenant(pool, schema, async (tx) => {
      await tx.query("insert into channel_mappings (property_id, room_type_id, rate_plan_id, external_id) values ($1, $2, $3, $4)", [propertyId, p.room_type_id, p.plan_id, id]);
      await enqueueHorizon(tx, propertyId, "restrictions", p.room_type_id, p.plan_id);
    });
    created++;
  }
  return created;
}

async function enqueueHorizon(tx: PoolClient, propertyId: string, kind: "availability" | "restrictions", roomTypeId: string, ratePlanId: string | null): Promise<void> {
  await tx.query(
    `insert into ari_outbox (property_id, kind, room_type_id, rate_plan_id, date_from, date_to)
     select $1, $2, $3, $4, business_date, business_date + $5::int - 1 from properties where id = $1`,
    [propertyId, kind, roomTypeId, ratePlanId, FULL_PUSH_DAYS],
  );
}

/** Everything mapped, over the whole horizon (the nightly full push, and once after connecting). */
export async function enqueueFullPush(tx: PoolClient, propertyId: string): Promise<void> {
  const { rows } = await tx.query<{ room_type_id: string; rate_plan_id: string | null }>("select room_type_id, rate_plan_id from channel_mappings where property_id = $1", [propertyId]);
  for (const m of rows) await enqueueHorizon(tx, propertyId, m.rate_plan_id ? "restrictions" : "availability", m.room_type_id, m.rate_plan_id);
  await tx.query("update channel_connections set full_push_at = now() where property_id = $1", [propertyId]);
}

/** The nightly full push of every connected property of the tenant. */
export async function enqueueFullPushes(pool: Pool, schema: string): Promise<number> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ property_id: string }>("select property_id from channel_connections");
    for (const r of rows) await enqueueFullPush(tx, r.property_id);
    return rows.length;
  });
}

export interface PushResult {
  /** Outbox rows taken and sent. */
  sent: number;
  availability: number;
  restrictions: number;
  /** The push failed: the reason; the rows wait for the next run. */
  error: string | null;
  /** A failure nobody has been told of yet: tell Revenue and the Property Manager. */
  alert: boolean;
}

const CLAIM_LIMIT = 5000;

/** Push what waits for one property. */
export async function pushChannels(pool: Pool, schema: string, propertyId: string, manager: ChannelManager): Promise<PushResult> {
  const none: PushResult = { sent: 0, availability: 0, restrictions: 0, error: null, alert: false };
  const connected = await channelConnection(pool, schema, propertyId);
  if (!connected) return none;
  try {
    await syncChannelMappings(pool, schema, propertyId, manager);
  } catch (err) {
    return failed(pool, schema, propertyId, [], err);
  }
  // taken by this run; a run that died leaves them taken for ten minutes, then they are taken again
  const claimed = await withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; kind: "availability" | "restrictions"; room_type_id: string; rate_plan_id: string | null; date_from: string; date_to: string }>(
      `update ari_outbox o set claimed_at = now()
       from (select id from ari_outbox where property_id = $1 and sent_at is null and (claimed_at is null or claimed_at < now() - interval '10 minutes') order by id limit $2 for update skip locked) d
       where o.id = d.id returning o.id, o.kind, o.room_type_id, o.rate_plan_id, to_char(o.date_from, 'YYYY-MM-DD') as date_from, to_char(o.date_to, 'YYYY-MM-DD') as date_to`,
      [propertyId, CLAIM_LIMIT],
    );
    return rows;
  });
  if (!claimed.length) return none;
  const ids = claimed.map((c) => c.id);
  let values: { availability: AvailabilityValue[]; restrictions: RestrictionValue[] };
  try {
    values = await withTenant(pool, schema, (tx) => currentValues(tx, propertyId, connected.externalId, claimed));
    await manager.pushAvailability(values.availability);
    await manager.pushRestrictions(values.restrictions);
  } catch (err) {
    return failed(pool, schema, propertyId, ids, err);
  }
  await withTenant(pool, schema, async (tx) => {
    await tx.query("update ari_outbox set sent_at = now() where id = any($1::bigint[])", [ids]);
    await tx.query("update channel_connections set failing_since = null, last_error = null, alerted_at = null where property_id = $1", [propertyId]);
  });
  return { sent: ids.length, availability: values.availability.length, restrictions: values.restrictions.length, error: null, alert: false };
}

async function failed(pool: Pool, schema: string, propertyId: string, ids: string[], err: unknown): Promise<PushResult> {
  const message = err instanceof Error ? err.message.slice(0, 500) : String(err);
  if (!(err instanceof ChannelError)) console.error("[channels] push failed", err);
  const alert = await withTenant(pool, schema, async (tx) => {
    // released for the next run
    if (ids.length) await tx.query("update ari_outbox set claimed_at = null where id = any($1::bigint[])", [ids]);
    // alerted once per failing streak: only the run that set alerted_at tells
    const { rows } = await tx.query<{ alert: boolean }>(
      `update channel_connections set failing_since = coalesce(failing_since, now()), last_error = $2, alerted_at = coalesce(alerted_at, now())
       where property_id = $1 returning alerted_at = now() as alert`,
      [propertyId, message],
    );
    return rows[0]?.alert ?? false;
  });
  return { sent: 0, availability: 0, restrictions: 0, error: message, alert };
}

/** The values to send for the claimed rows: the current state of those days, within the horizon, compressed to ranges. */
async function currentValues(
  tx: PoolClient,
  propertyId: string,
  externalPropertyId: string,
  rows: { kind: "availability" | "restrictions"; room_type_id: string; rate_plan_id: string | null; date_from: string; date_to: string }[],
): Promise<{ availability: AvailabilityValue[]; restrictions: RestrictionValue[] }> {
  const bd = (await tx.query<{ d: string }>("select to_char(business_date, 'YYYY-MM-DD') as d from properties where id = $1", [propertyId])).rows[0]!.d;
  const last = addDays(bd, FULL_PUSH_DAYS - 1);
  const { rows: maps } = await tx.query<{ room_type_id: string; rate_plan_id: string | null; external_id: string }>("select room_type_id, rate_plan_id, external_id from channel_mappings where property_id = $1", [propertyId]);
  const external = new Map(maps.map((m) => [`${m.room_type_id}|${m.rate_plan_id ?? ""}`, m.external_id]));
  const index = await loadPlanIndex(tx, propertyId);
  // the days of each room type and of each pair; a base plan's change reaches its derived plans' inherited restrictions
  const days = new Map<string, Set<string>>();
  const add = (key: string, from: string, to: string) => {
    const set = days.get(key) ?? new Set<string>();
    for (let d = from < bd ? bd : from; d <= to && d <= last; d = addDays(d, 1)) set.add(d);
    days.set(key, set);
  };
  for (const r of rows) {
    if (r.kind === "availability") add(`a|${r.room_type_id}`, r.date_from, r.date_to);
    else {
      add(`r|${r.room_type_id}|${r.rate_plan_id}`, r.date_from, r.date_to);
      for (const p of index.values()) if (p.basePlanId === r.rate_plan_id) add(`r|${r.room_type_id}|${p.id}`, r.date_from, r.date_to);
    }
  }
  const all = [...days.values()].flatMap((s) => [...s]).sort();
  if (!all.length) return { availability: [], restrictions: [] };
  const data = await loadQuoteData(tx, propertyId, all[0]!, addDays(all[all.length - 1]!, 1));
  const types = new Map(data.types.map((t) => [t.id, t]));
  const plans = new Map(data.plans.map((p) => [p.id, p]));
  const availability: AvailabilityValue[] = [];
  const restrictions: RestrictionValue[] = [];
  for (const [key, set] of days) {
    const sorted = [...set].sort();
    const [kind, roomTypeId, planId] = key.split("|") as ["a" | "r", string, string | undefined];
    const type = types.get(roomTypeId);
    if (!type) continue;
    if (kind === "a") {
      const ext = external.get(`${roomTypeId}|`);
      if (!ext) continue;
      for (const r of compressDays(sorted, (d) => Math.max(0, type.rooms - data.roomsTaken(roomTypeId, d)))) {
        availability.push({ propertyId: externalPropertyId, roomTypeId: ext, dateFrom: r.from, dateTo: r.to, availability: r.value });
      }
    } else {
      const ext = external.get(`${roomTypeId}|${planId}`);
      const plan = planId ? plans.get(planId) : undefined;
      // a pair not sold on channels (or no longer) has no external rate plan
      if (!ext || !plan) continue;
      const priced = { baseOccupancy: plan.base_occupancy, supplements: plan.supplements.filter((s) => s.kind !== "child").map((s) => ({ kind: s.kind, amount: Number(s.amount) })) };
      for (const r of compressDays(sorted, (d) => channelRestriction(data.price(plan.id, roomTypeId, d), data.restriction(plan.id, roomTypeId, d), priced, type.max_adults))) {
        restrictions.push({ propertyId: externalPropertyId, ratePlanId: ext, dateFrom: r.from, dateTo: r.to, ...r.value });
      }
    }
  }
  return { availability, restrictions };
}

/** What the rates grid shows: connected, changes waiting, failing. */
export async function channelStatus(pool: Pool, schema: string, propertyId: string): Promise<ChannelStatus & { lastError: string | null }> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ failing_since: Date | null; last_error: string | null; pending: number }>(
      `select c.failing_since, c.last_error, (select count(*)::int from ari_outbox o where o.property_id = c.property_id and o.sent_at is null) as pending
       from channel_connections c where c.property_id = $1`,
      [propertyId],
    );
    const r = rows[0];
    return r ? { connected: true, pending: r.pending, failing: r.failing_since !== null, lastError: r.last_error } : { connected: false, pending: 0, failing: false, lastError: null };
  });
}

/** Connected properties of the tenant, for the push job. */
export async function connectedProperties(pool: Pool, schema: string): Promise<string[]> {
  return withTenant(pool, schema, async (tx) => (await tx.query<{ property_id: string }>("select property_id from channel_connections")).rows.map((r) => r.property_id));
}

/** Push one property in full once more (staff asked). */
export async function enqueueFullPushOf(pool: Pool, schema: string, propertyId: string): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    if (!(await tx.query("select 1 from channel_connections where property_id = $1", [propertyId])).rows.length) throw new Error("This property is not connected");
    await enqueueFullPush(tx, propertyId);
  });
}

/** What is mapped at the channel manager: room types, and each (rate plan, room type) pair. */
export async function channelMappings(pool: Pool, schema: string, propertyId: string): Promise<{ roomTypeName: string; ratePlanName: string | null; externalId: string }[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ room_type: string; rate_plan: string | null; external_id: string }>(
      `select t.name as room_type, p.name as rate_plan, m.external_id
       from channel_mappings m join room_types t on t.id = m.room_type_id left join rate_plans p on p.id = m.rate_plan_id
       where m.property_id = $1 order by m.rate_plan_id nulls first, t.sort_order, p.sort_order`,
      [propertyId],
    );
    return rows.map((r) => ({ roomTypeName: r.room_type, ratePlanName: r.rate_plan, externalId: r.external_id }));
  });
}
