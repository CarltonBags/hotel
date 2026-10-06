import type { Pool, PoolClient } from "pg";
import { FULL_PUSH_DAYS, addDays, channelRestriction, compressDays, type ChannelStatus } from "@hoteloftware/domain";
import { ChannelError, type AvailabilityValue, type ChannelManager, type RestrictionValue } from "@hoteloftware/channels";
import { mapProviderAccount } from "../control/external-ids";
import { loadPlanIndex } from "./rates";
import { loadQuoteData } from "./reservations";
import { withTenant } from "./with-tenant";

/**
 * The channel manager connection (ticket 37). Connecting projects the
 * property, its room types and each (rate plan, room type) pair sold on
 * channels; the mapping is kept on every push: new pairs created, changed
 * room counts and adult counts sent, withdrawn pairs closed and dropped.
 * Changes reach the ARI outbox through triggers in the same transaction; a
 * push takes what is waiting, works out the current values of those days and
 * sends them, availability then restrictions, each marked sent once the
 * channel manager took it. One sync or push runs per property at a time.
 */

export interface ChannelConnection {
  provider: string;
  externalId: string | null;
  connectedAt: Date;
  fullPushAt: Date | null;
  failingSince: Date | null;
  lastError: string | null;
  closedAt: Date | null;
}

type OutboxKind = "availability" | "restrictions";

/** Channex's size limits per property. */
const MAX_ROOM_TYPES = 20;
const MAX_RATE_PLANS = 200;
/** A run that died leaves its claim; after this the rows are taken again. */
const CLAIM_MINUTES = 2;
const LEASE_MINUTES = 5;
const CLAIM_LIMIT = 5000;

async function connectionIn(tx: PoolClient, propertyId: string): Promise<ChannelConnection | null> {
  const { rows } = await tx.query("select provider, external_id, connected_at, full_push_at, failing_since, last_error, closed_at from channel_connections where property_id = $1", [propertyId]);
  const r = rows[0];
  return r ? { provider: r.provider, externalId: r.external_id, connectedAt: r.connected_at, fullPushAt: r.full_push_at, failingSince: r.failing_since, lastError: r.last_error, closedAt: r.closed_at } : null;
}

export async function channelConnection(pool: Pool, schema: string, propertyId: string): Promise<ChannelConnection | null> {
  return withTenant(pool, schema, (tx) => connectionIn(tx, propertyId));
}

/** One sync or push per property at a time: taken for a few minutes, given back when done. */
async function takeLease(pool: Pool, schema: string, propertyId: string): Promise<boolean> {
  return withTenant(pool, schema, async (tx) => {
    const { rowCount } = await tx.query(
      "update channel_connections set busy_until = now() + make_interval(mins => $2) where property_id = $1 and (busy_until is null or busy_until < now())",
      [propertyId, LEASE_MINUTES],
    );
    return (rowCount ?? 0) > 0;
  });
}

async function releaseLease(pool: Pool, schema: string, propertyId: string): Promise<void> {
  await withTenant(pool, schema, (tx) => tx.query("update channel_connections set busy_until = null where property_id = $1", [propertyId]));
}

/**
 * Connect a property: the connection is taken first (a second attempt, or the
 * worker, waits), then the property, its room types and rate plans are created
 * at the channel manager and everything is pushed once. A failed attempt is
 * cleared, so trying again starts over.
 */
export async function connectChannels(pool: Pool, schema: string, input: { tenantId: string; propertyId: string; email: string }, manager: ChannelManager, userId: string): Promise<void> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new Error("An email address for the channel manager is needed");
  const property = await withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ name: string; currency: string; time_zone: string }>("select name, currency, time_zone from properties where id = $1", [input.propertyId]);
    if (!rows[0]) throw new Error("Property not found");
    // an attempt that died half-way is cleared
    await tx.query("delete from channel_connections where property_id = $1 and external_id is null and busy_until < now()", [input.propertyId]);
    const taken = await tx.query(
      "insert into channel_connections (property_id, provider, connected_by, busy_until) values ($1, $2, $3, now() + make_interval(mins => $4)) on conflict (property_id) do nothing",
      [input.propertyId, manager.name, userId, LEASE_MINUTES],
    );
    if (!taken.rowCount) throw new Error("This property is connected already, or being connected");
    return rows[0];
  });
  try {
    const externalId = await manager.createProperty({ title: property.name, currency: property.currency, timezone: property.time_zone, email: input.email });
    await withTenant(pool, schema, (tx) => tx.query("update channel_connections set external_id = $2 where property_id = $1", [input.propertyId, externalId]));
    // the channel manager's property id finds the tenant for its webhooks (ticket 38)
    await mapProviderAccount(pool, manager.name, externalId, input.tenantId, input.propertyId);
    await syncMappings(pool, schema, input.propertyId, externalId, manager);
    await withTenant(pool, schema, (tx) => enqueueFullPush(tx, input.propertyId));
  } catch (err) {
    // nothing half made stays: the next attempt starts over (what was created at the channel manager is left there)
    await withTenant(pool, schema, async (tx) => {
      await tx.query("delete from channel_mappings where property_id = $1", [input.propertyId]);
      await tx.query("delete from ari_outbox where property_id = $1", [input.propertyId]);
      await tx.query("delete from channel_connections where property_id = $1", [input.propertyId]);
    });
    throw err;
  }
  await releaseLease(pool, schema, input.propertyId);
}

interface MappingState {
  types: { id: string; name: string; max_adults: number; max_occupancy: number; rooms: number; external_id: string | null; sent_rooms: number | null }[];
  /** Pairs sold on channels now. */
  sold: { plan_id: string; plan_name: string; base_occupancy: number; room_type_id: string; currency: string }[];
  /** Pairs mapped. */
  mapped: { rate_plan_id: string; room_type_id: string; external_id: string; max_adults: number | null }[];
}

async function mappingState(tx: PoolClient, propertyId: string): Promise<MappingState> {
  const { rows: types } = await tx.query(
    `select t.id, t.name, t.max_adults, t.max_occupancy, (select count(*)::int from rooms r where r.room_type_id = t.id) as rooms, m.external_id, m.rooms as sent_rooms
     from room_types t left join channel_mappings m on m.room_type_id = t.id and m.rate_plan_id is null where t.property_id = $1 order by t.sort_order, t.code`,
    [propertyId],
  );
  const { rows: sold } = await tx.query(
    `select p.id as plan_id, p.name as plan_name, p.base_occupancy, rt.room_type_id, pr.currency
     from rate_plans p join rate_plan_room_types rt on rt.rate_plan_id = p.id join properties pr on pr.id = p.property_id
     where p.property_id = $1 and p.active and p.sold_on_channels order by p.sort_order, p.code`,
    [propertyId],
  );
  const { rows: mapped } = await tx.query("select rate_plan_id, room_type_id, external_id, max_adults from channel_mappings where property_id = $1 and rate_plan_id is not null", [propertyId]);
  return { types, sold, mapped };
}

/** Keep the mapping (the caller holds the property's lease). */
async function syncMappings(pool: Pool, schema: string, propertyId: string, externalPropertyId: string, manager: ChannelManager): Promise<void> {
  const state = await withTenant(pool, schema, (tx) => mappingState(tx, propertyId));
  if (state.types.length > MAX_ROOM_TYPES || state.sold.length > MAX_RATE_PLANS) {
    throw new ChannelError(`Channex takes at most ${MAX_ROOM_TYPES} room types and ${MAX_RATE_PLANS} rate plans (rate plan × room type) per property; this property has ${state.types.length} and ${state.sold.length}`, false);
  }
  const typeExternal = new Map<string, string>();
  const roomTypeOf = (t: MappingState["types"][number]) => ({ propertyId: externalPropertyId, title: t.name, rooms: t.rooms, maxAdults: t.max_adults, maxChildren: Math.max(0, t.max_occupancy - t.max_adults), defaultOccupancy: Math.min(2, t.max_adults) });
  for (const t of state.types) {
    if (!t.external_id) {
      const id = await manager.createRoomType(roomTypeOf(t));
      await withTenant(pool, schema, async (tx) => {
        await tx.query("insert into channel_mappings (property_id, room_type_id, external_id, rooms) values ($1, $2, $3, $4)", [propertyId, t.id, id, t.rooms]);
        await enqueueHorizon(tx, propertyId, "availability", t.id, null);
      });
      typeExternal.set(t.id, id);
    } else {
      typeExternal.set(t.id, t.external_id);
      if (t.sent_rooms !== t.rooms) {
        await manager.updateRoomType(t.external_id, roomTypeOf(t));
        await withTenant(pool, schema, (tx) => tx.query("update channel_mappings set rooms = $2 where room_type_id = $1 and rate_plan_id is null", [t.id, t.rooms]));
      }
    }
  }
  const typeById = new Map(state.types.map((t) => [t.id, t]));
  for (const p of state.sold) {
    const type = typeById.get(p.room_type_id)!;
    const plan = { propertyId: externalPropertyId, roomTypeId: typeExternal.get(p.room_type_id)!, title: `${p.plan_name} · ${type.name}`, currency: p.currency, primaryOccupancy: p.base_occupancy, maxAdults: type.max_adults };
    const mapped = state.mapped.find((m) => m.rate_plan_id === p.plan_id && m.room_type_id === p.room_type_id);
    if (!mapped) {
      const id = await manager.createRatePlan(plan);
      await withTenant(pool, schema, async (tx) => {
        await tx.query("insert into channel_mappings (property_id, room_type_id, rate_plan_id, external_id, max_adults) values ($1, $2, $3, $4, $5)", [propertyId, p.room_type_id, p.plan_id, id, type.max_adults]);
        await enqueueHorizon(tx, propertyId, "restrictions", p.room_type_id, p.plan_id);
      });
    } else if (mapped.max_adults !== type.max_adults) {
      // the occupancy options follow the room type's adults; then every price again
      await manager.updateRatePlan(mapped.external_id, plan);
      await withTenant(pool, schema, async (tx) => {
        await tx.query("update channel_mappings set max_adults = $3 where rate_plan_id = $1 and room_type_id = $2", [p.plan_id, p.room_type_id, type.max_adults]);
        await enqueueHorizon(tx, propertyId, "restrictions", p.room_type_id, p.plan_id);
      });
    }
  }
  // withdrawn pairs (plan off channels or inactive, room type taken off the plan): closed over the horizon, then dropped
  const withdrawn = state.mapped.filter((m) => !state.sold.some((p) => p.plan_id === m.rate_plan_id && p.room_type_id === m.room_type_id));
  if (withdrawn.length) {
    const bd = await withTenant(pool, schema, async (tx) => (await tx.query<{ d: string }>("select to_char(business_date, 'YYYY-MM-DD') as d from properties where id = $1", [propertyId])).rows[0]!.d);
    await manager.pushRestrictions(withdrawn.map((m) => closedValue(externalPropertyId, m.external_id, bd)));
    await withTenant(pool, schema, async (tx) => {
      for (const m of withdrawn) await tx.query("delete from channel_mappings where rate_plan_id = $1 and room_type_id = $2", [m.rate_plan_id, m.room_type_id]);
    });
  }
}

const closedValue = (propertyId: string, ratePlanId: string, from: string): RestrictionValue => ({
  propertyId,
  ratePlanId,
  dateFrom: from,
  dateTo: addDays(from, FULL_PUSH_DAYS - 1),
  rates: [],
  stopSell: true,
  closedToArrival: false,
  closedToDeparture: false,
  minStayArrival: 1,
  minStayThrough: 1,
  maxStay: 0,
});

async function enqueueHorizon(tx: PoolClient, propertyId: string, kind: OutboxKind, roomTypeId: string, ratePlanId: string | null): Promise<void> {
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
    const { rows } = await tx.query<{ property_id: string }>("select property_id from channel_connections where external_id is not null and closed_at is null");
    for (const r of rows) await enqueueFullPush(tx, r.property_id);
    return rows.length;
  });
}

/** Push one property in full once more (staff asked). */
export async function enqueueFullPushOf(pool: Pool, schema: string, propertyId: string): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    if (!(await tx.query("select 1 from channel_connections where property_id = $1 and external_id is not null", [propertyId])).rows.length) throw new Error("This property is not connected");
    await enqueueFullPush(tx, propertyId);
  });
}

export interface PushResult {
  /** Outbox rows sent. */
  sent: number;
  availability: number;
  restrictions: number;
  /** A call failed: why. Rows of a retryable failure wait for the next run; refused rows are set aside. */
  error: string | null;
  /** A failure nobody has been told of lately: tell Revenue and the Property Manager. */
  alert: boolean;
  /** Sales were closed (non-payment) or opened again in this run. */
  closed?: boolean;
  reopened?: boolean;
}

interface Claimed {
  id: string;
  kind: OutboxKind;
  room_type_id: string;
  rate_plan_id: string | null;
  date_from: string;
  date_to: string;
}

/**
 * Push what waits for one property. While the tenant may take no online
 * reservations (unpaid from day 60, or the contract ended) its sales are
 * closed at the channels and the changes wait; when it may again, everything
 * is pushed in full.
 */
export async function pushChannels(pool: Pool, schema: string, propertyId: string, manager: ChannelManager, options: { acceptsReservations: boolean } = { acceptsReservations: true }): Promise<PushResult> {
  const none: PushResult = { sent: 0, availability: 0, restrictions: 0, error: null, alert: false };
  if (!(await takeLease(pool, schema, propertyId))) return none;
  try {
    const conn = await channelConnection(pool, schema, propertyId);
    if (!conn?.externalId) return none;
    if (!options.acceptsReservations) {
      if (conn.closedAt) return none;
      const bd = await withTenant(pool, schema, async (tx) => (await tx.query<{ d: string }>("select to_char(business_date, 'YYYY-MM-DD') as d from properties where id = $1", [propertyId])).rows[0]!.d);
      const pairs = await withTenant(pool, schema, async (tx) => (await tx.query<{ external_id: string }>("select external_id from channel_mappings where property_id = $1 and rate_plan_id is not null", [propertyId])).rows);
      try {
        await manager.pushRestrictions(pairs.map((p) => closedValue(conn.externalId!, p.external_id, bd)));
      } catch (err) {
        return failed(pool, schema, propertyId, err);
      }
      await withTenant(pool, schema, (tx) => tx.query("update channel_connections set closed_at = now() where property_id = $1", [propertyId]));
      return { ...none, closed: true };
    }
    let reopened = false;
    if (conn.closedAt) {
      await withTenant(pool, schema, async (tx) => {
        await tx.query("update channel_connections set closed_at = null where property_id = $1", [propertyId]);
        await enqueueFullPush(tx, propertyId);
      });
      reopened = true;
    }
    try {
      await syncMappings(pool, schema, propertyId, conn.externalId, manager);
    } catch (err) {
      return failed(pool, schema, propertyId, err);
    }
    const claimed = await withTenant(pool, schema, async (tx) => {
      const { rows } = await tx.query<Claimed>(
        `update ari_outbox o set claimed_at = now()
         from (select id from ari_outbox where property_id = $1 and sent_at is null and refused_at is null and (claimed_at is null or claimed_at < now() - make_interval(mins => $3))
               order by id limit $2 for update skip locked) d
         where o.id = d.id returning o.id, o.kind, o.room_type_id, o.rate_plan_id, to_char(o.date_from, 'YYYY-MM-DD') as date_from, to_char(o.date_to, 'YYYY-MM-DD') as date_to`,
        [propertyId, CLAIM_LIMIT, CLAIM_MINUTES],
      );
      return rows;
    });
    if (!claimed.length) return { ...none, reopened };
    const values = await withTenant(pool, schema, (tx) => currentValues(tx, propertyId, conn.externalId!, claimed));
    const result: PushResult = { ...none, reopened };
    // availability first, then restrictions: each kind is marked once the channel manager took it
    for (const kind of ["availability", "restrictions"] as const) {
      const ids = claimed.filter((c) => c.kind === kind).map((c) => c.id);
      if (!ids.length) continue;
      try {
        if (kind === "availability") await manager.pushAvailability(values.availability);
        else await manager.pushRestrictions(values.restrictions);
      } catch (err) {
        const f = await failed(pool, schema, propertyId, err, ids);
        result.error = f.error;
        result.alert = result.alert || f.alert;
        continue;
      }
      await withTenant(pool, schema, (tx) => tx.query("update ari_outbox set sent_at = now() where id = any($1::bigint[])", [ids]));
      result.sent += ids.length;
      if (kind === "availability") result.availability = values.availability.length;
      else result.restrictions = values.restrictions.length;
    }
    // working again: the failing state goes; the alert stays quiet for an hour against flapping
    if (!result.error) {
      await withTenant(pool, schema, (tx) =>
        tx.query("update channel_connections set failing_since = null, last_error = null, alerted_at = case when alerted_at < now() - interval '1 hour' then null else alerted_at end where property_id = $1", [propertyId]),
      );
    }
    return result;
  } finally {
    await releaseLease(pool, schema, propertyId);
  }
}

/** A failed call: retryable rows go back to wait, refused ones are set aside with the reason; the property is failing; told once. */
async function failed(pool: Pool, schema: string, propertyId: string, err: unknown, ids: string[] = []): Promise<PushResult> {
  const message = err instanceof Error ? err.message.slice(0, 500) : String(err);
  if (!(err instanceof ChannelError)) console.error("[channels] push failed", err);
  const retry = !(err instanceof ChannelError) || err.retry;
  const alert = await withTenant(pool, schema, async (tx) => {
    if (ids.length) {
      if (retry) await tx.query("update ari_outbox set claimed_at = null where id = any($1::bigint[])", [ids]);
      else await tx.query("update ari_outbox set refused_at = now(), error = $2 where id = any($1::bigint[])", [ids, message]);
    }
    // told only by the run that set alerted_at
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
async function currentValues(tx: PoolClient, propertyId: string, externalPropertyId: string, rows: Claimed[]): Promise<{ availability: AvailabilityValue[]; restrictions: RestrictionValue[] }> {
  const bd = (await tx.query<{ d: string }>("select to_char(business_date, 'YYYY-MM-DD') as d from properties where id = $1", [propertyId])).rows[0]!.d;
  const last = addDays(bd, FULL_PUSH_DAYS - 1);
  const { rows: maps } = await tx.query<{ room_type_id: string; rate_plan_id: string | null; external_id: string }>("select room_type_id, rate_plan_id, external_id from channel_mappings where property_id = $1", [propertyId]);
  const typeExternal = new Map(maps.filter((m) => !m.rate_plan_id).map((m) => [m.room_type_id, m.external_id]));
  const pairExternal = new Map(maps.filter((m) => m.rate_plan_id).map((m) => [`${m.rate_plan_id}|${m.room_type_id}`, m.external_id]));
  const index = await loadPlanIndex(tx, propertyId);
  // the days of each room type, and of each pair; a base plan's change reaches its derived plans' inherited restrictions
  const typeDays = new Map<string, Set<string>>();
  const pairDays = new Map<string, { planId: string; roomTypeId: string; days: Set<string> }>();
  const span = (from: string, to: string, into: Set<string>) => {
    for (let d = from < bd ? bd : from; d <= to && d <= last; d = addDays(d, 1)) into.add(d);
  };
  const pair = (planId: string, roomTypeId: string) => {
    const key = `${planId}|${roomTypeId}`;
    if (!pairDays.has(key)) pairDays.set(key, { planId, roomTypeId, days: new Set() });
    return pairDays.get(key)!.days;
  };
  for (const r of rows) {
    if (r.kind === "availability") {
      if (!typeDays.has(r.room_type_id)) typeDays.set(r.room_type_id, new Set());
      span(r.date_from, r.date_to, typeDays.get(r.room_type_id)!);
    } else if (r.rate_plan_id) {
      span(r.date_from, r.date_to, pair(r.rate_plan_id, r.room_type_id));
      for (const p of index.values()) if (p.basePlanId === r.rate_plan_id) span(r.date_from, r.date_to, pair(p.id, r.room_type_id));
    }
  }
  const all = [...typeDays.values(), ...[...pairDays.values()].map((p) => p.days)].flatMap((s) => [...s]).sort();
  if (!all.length) return { availability: [], restrictions: [] };
  const data = await loadQuoteData(tx, propertyId, all[0]!, addDays(all[all.length - 1]!, 1));
  const types = new Map(data.types.map((t) => [t.id, t]));
  const plans = new Map(data.plans.map((p) => [p.id, p]));
  const availability: AvailabilityValue[] = [];
  for (const [roomTypeId, set] of typeDays) {
    const type = types.get(roomTypeId);
    const ext = typeExternal.get(roomTypeId);
    if (!type || !ext) continue;
    for (const r of compressDays([...set].sort(), (d) => Math.max(0, type.rooms - data.roomsTaken(roomTypeId, d)))) {
      availability.push({ propertyId: externalPropertyId, roomTypeId: ext, dateFrom: r.from, dateTo: r.to, availability: r.value });
    }
  }
  const restrictions: RestrictionValue[] = [];
  for (const { planId, roomTypeId, days } of pairDays.values()) {
    const type = types.get(roomTypeId);
    const plan = plans.get(planId);
    const ext = pairExternal.get(`${planId}|${roomTypeId}`);
    // a pair not sold on channels has no external rate plan (a withdrawn one was closed when it was dropped)
    if (!type || !plan || !ext) continue;
    const priced = { baseOccupancy: plan.base_occupancy, supplements: plan.supplements.filter((s) => s.kind !== "child").map((s) => ({ kind: s.kind, amount: Number(s.amount) })) };
    for (const r of compressDays([...days].sort(), (d) => channelRestriction(data.price(plan.id, roomTypeId, d), data.restriction(plan.id, roomTypeId, d), priced, type.max_adults))) {
      restrictions.push({ propertyId: externalPropertyId, ratePlanId: ext, dateFrom: r.from, dateTo: r.to, ...r.value });
    }
  }
  return { availability, restrictions };
}

export interface ChannelOverview {
  connection: ChannelConnection | null;
  status: ChannelStatus & { lastError: string | null; lastSentAt: Date | null; refused: number };
  mappings: { roomTypeName: string; ratePlanName: string | null; externalId: string }[];
}

/** What the rates grid and the settings page show, in one read. */
export async function channelOverview(pool: Pool, schema: string, propertyId: string): Promise<ChannelOverview> {
  return withTenant(pool, schema, async (tx) => {
    const connection = await connectionIn(tx, propertyId);
    if (!connection?.externalId) return { connection, status: { connected: false, pending: 0, failing: false, lastError: null, lastSentAt: null, refused: 0 }, mappings: [] };
    const { rows: counts } = await tx.query<{ pending: number; refused: number; last_sent: Date | null }>(
      `select count(*) filter (where sent_at is null and refused_at is null)::int as pending, count(*) filter (where refused_at > now() - interval '1 day')::int as refused, max(sent_at) as last_sent
       from ari_outbox where property_id = $1`,
      [propertyId],
    );
    const { rows: maps } = await tx.query<{ room_type: string; rate_plan: string | null; external_id: string }>(
      `select t.name as room_type, p.name as rate_plan, m.external_id
       from channel_mappings m join room_types t on t.id = m.room_type_id left join rate_plans p on p.id = m.rate_plan_id
       where m.property_id = $1 order by m.rate_plan_id nulls first, t.sort_order, p.sort_order`,
      [propertyId],
    );
    const c = counts[0]!;
    return {
      connection,
      status: { connected: true, pending: c.pending, failing: connection.failingSince !== null, lastError: connection.lastError, lastSentAt: c.last_sent, refused: c.refused },
      mappings: maps.map((r) => ({ roomTypeName: r.room_type, ratePlanName: r.rate_plan, externalId: r.external_id })),
    };
  });
}

/** Connected properties of the tenant, for the push job. */
export async function connectedProperties(pool: Pool, schema: string): Promise<string[]> {
  return withTenant(pool, schema, async (tx) => (await tx.query<{ property_id: string }>("select property_id from channel_connections where external_id is not null")).rows.map((r) => r.property_id));
}

/** Sent and refused outbox rows are kept a week, then deleted. */
export async function pruneChannelOutbox(pool: Pool, schema: string): Promise<number> {
  return withTenant(pool, schema, async (tx) => (await tx.query("delete from ari_outbox where coalesce(sent_at, refused_at) < now() - interval '7 days'")).rowCount ?? 0);
}
