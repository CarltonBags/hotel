import type { Pool, PoolClient } from "pg";
import { mergeNames, validateAgeBands, type AgeBandInput, type AgeBandIssue, type Names, checkPlanLimits, roundMoney } from "@hoteloftware/domain";
import { lockProperty } from "./property-lock";
import { withTenant } from "./with-tenant";

export type { Names };

export interface RoomTypeInput {
  propertyId: string;
  code: string;
  name: string;
  names?: Names;
  maxOccupancy: number;
  maxAdults: number;
  bedPlaces: number;
  extraBeds: number;
  sortOrder?: number;
  /** Lowest nightly price staff may set without the Property Manager; null = none. */
  priceFloor?: number | null;
}

export interface RoomType extends Omit<RoomTypeInput, "names" | "sortOrder" | "priceFloor"> {
  id: string;
  names: Names;
  sortOrder: number;
  priceFloor: number | null;
  roomCount: number;
}

export interface Section {
  id: string;
  propertyId: string;
  name: string;
  sortOrder: number;
}

export interface RoomFeature {
  id: string;
  propertyId: string;
  code: string;
  name: string;
  names: Names;
}

export interface Room {
  id: string;
  propertyId: string;
  roomTypeId: string;
  roomTypeCode: string;
  roomTypeName: string;
  number: string;
  name: string;
  names: Names;
  floor: string;
  sectionId: string | null;
  sectionName: string | null;
  bedPlaces: number;
  extraBeds: number;
  sortOrder: number;
  features: { id: string; code: string; name: string }[];
}

export interface AgeBand extends AgeBandInput {
  id: string;
  propertyId: string;
}

function uniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

function requireText(value: string, what: string): string {
  const v = value.trim();
  if (!v) throw new Error(`${what} is required`);
  return v;
}

function requireInt(value: number, what: string, min: number): number {
  if (!Number.isInteger(value) || value < min) throw new Error(`${what} must be a whole number of at least ${min}`);
  return value;
}

const ROOM_TYPE_SELECT = `select rt.id, rt.property_id, rt.code, rt.name, rt.names, rt.max_occupancy, rt.max_adults, rt.bed_places, rt.extra_beds, rt.sort_order, rt.price_floor,
    (select count(*)::int from rooms r where r.room_type_id = rt.id) as room_count
  from room_types rt`;

interface RoomTypeRow {
  id: string;
  property_id: string;
  code: string;
  name: string;
  names: Names;
  max_occupancy: number;
  max_adults: number;
  bed_places: number;
  extra_beds: number;
  sort_order: number;
  price_floor: string | null;
  room_count: number;
}

function toRoomType(r: RoomTypeRow): RoomType {
  return {
    id: r.id,
    propertyId: r.property_id,
    code: r.code,
    name: r.name,
    names: r.names ?? {},
    maxOccupancy: r.max_occupancy,
    maxAdults: r.max_adults,
    bedPlaces: r.bed_places,
    extraBeds: r.extra_beds,
    sortOrder: r.sort_order,
    priceFloor: r.price_floor === null ? null : Number(r.price_floor),
    roomCount: r.room_count,
  };
}

function checkPriceFloor(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) throw new Error("Price Floor must be zero or more");
  return roundMoney(value);
}

export async function createRoomType(pool: Pool, schema: string, input: RoomTypeInput): Promise<RoomType> {
  const code = requireText(input.code, "Code").toUpperCase();
  const name = requireText(input.name, "Name");
  const maxAdults = requireInt(input.maxAdults, "Max adults", 1);
  const maxOccupancy = requireInt(input.maxOccupancy, "Max occupancy", maxAdults);
  requireInt(input.bedPlaces, "Bed places", 0);
  requireInt(input.extraBeds, "Extra beds", 0);
  const priceFloor = checkPriceFloor(input.priceFloor ?? null);
  return withTenant(pool, schema, async (tx) => {
    // channel manager limit ("Channel manager selection"): count under a property lock so two inserts cannot both pass
    await lockProperty(tx, input.propertyId);
    try {
      const { rows } = await tx.query<{ id: string }>(
        `insert into room_types (property_id, code, name, names, max_occupancy, max_adults, bed_places, extra_beds, sort_order, price_floor)
         values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9, (select coalesce(max(sort_order), 0) + 1 from room_types where property_id = $1)), $10)
         returning id`,
        [input.propertyId, code, name, JSON.stringify(input.names ?? {}), maxOccupancy, maxAdults, input.bedPlaces, input.extraBeds, input.sortOrder ?? null, priceFloor],
      );
      const count = await tx.query<{ n: number }>("select count(*)::int as n from room_types where property_id = $1", [input.propertyId]);
      const limit = checkPlanLimits({ roomTypes: count.rows[0]?.n ?? 0, projectedRatePlans: 0 });
      if (limit) throw new Error(limit);
      const found = await tx.query<RoomTypeRow>(`${ROOM_TYPE_SELECT} where rt.id = $1`, [rows[0]!.id]);
      return toRoomType(found.rows[0]!);
    } catch (err) {
      if (uniqueViolation(err)) throw new Error(`Room Type ${code} already exists at this property`);
      throw err;
    }
  });
}

export async function updateRoomType(pool: Pool, schema: string, propertyId: string, id: string, patch: Partial<Omit<RoomTypeInput, "propertyId">>): Promise<RoomType> {
  return withTenant(pool, schema, async (tx) => {
    const current = await tx.query<RoomTypeRow>(`${ROOM_TYPE_SELECT} where rt.id = $1 and rt.property_id = $2`, [id, propertyId]);
    const c = current.rows[0];
    if (!c) throw new Error("Room Type not found");
    const code = patch.code !== undefined ? requireText(patch.code, "Code").toUpperCase() : c.code;
    const name = patch.name !== undefined ? requireText(patch.name, "Name") : c.name;
    const maxAdults = patch.maxAdults !== undefined ? requireInt(patch.maxAdults, "Max adults", 1) : c.max_adults;
    const maxOccupancy = patch.maxOccupancy !== undefined ? requireInt(patch.maxOccupancy, "Max occupancy", maxAdults) : c.max_occupancy;
    if (maxOccupancy < maxAdults) throw new Error("Max occupancy must be at least max adults");
    try {
      await tx.query(
        `update room_types set code = $2, name = $3, names = $4, max_occupancy = $5, max_adults = $6, bed_places = $7, extra_beds = $8, sort_order = $9, price_floor = $10, updated_at = now() where id = $1`,
        [
          id,
          code,
          name,
          JSON.stringify(patch.names ? mergeNames(c.names ?? {}, patch.names) : (c.names ?? {})),
          maxOccupancy,
          maxAdults,
          patch.bedPlaces !== undefined ? requireInt(patch.bedPlaces, "Bed places", 0) : c.bed_places,
          patch.extraBeds !== undefined ? requireInt(patch.extraBeds, "Extra beds", 0) : c.extra_beds,
          patch.sortOrder ?? c.sort_order,
          patch.priceFloor !== undefined ? checkPriceFloor(patch.priceFloor) : c.price_floor,
        ],
      );
    } catch (err) {
      if (uniqueViolation(err)) throw new Error(`Room Type ${code} already exists at this property`);
      throw err;
    }
    const found = await tx.query<RoomTypeRow>(`${ROOM_TYPE_SELECT} where rt.id = $1`, [id]);
    return toRoomType(found.rows[0]!);
  });
}

export async function listRoomTypes(pool: Pool, schema: string, propertyId: string): Promise<RoomType[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<RoomTypeRow>(`${ROOM_TYPE_SELECT} where rt.property_id = $1 order by rt.sort_order, rt.code`, [propertyId]);
    return rows.map(toRoomType);
  });
}

export async function deleteRoomType(pool: Pool, schema: string, propertyId: string, id: string): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const used = await tx.query("select 1 from rooms where room_type_id = $1 limit 1", [id]);
    if (used.rowCount) throw new Error("This Room Type still has rooms");
    const { rowCount } = await tx.query("delete from room_types where id = $1 and property_id = $2", [id, propertyId]);
    if (!rowCount) throw new Error("Room Type not found");
  });
}

// ---------- Sections and Room Features

export async function createSection(pool: Pool, schema: string, input: { propertyId: string; name: string; sortOrder?: number }): Promise<Section> {
  const name = requireText(input.name, "Name");
  return withTenant(pool, schema, async (tx) => {
    try {
      const { rows } = await tx.query<{ id: string; property_id: string; name: string; sort_order: number }>(
        `insert into sections (property_id, name, sort_order)
         values ($1, $2, coalesce($3, (select coalesce(max(sort_order), 0) + 1 from sections where property_id = $1))) returning id, property_id, name, sort_order`,
        [input.propertyId, name, input.sortOrder ?? null],
      );
      const r = rows[0]!;
      return { id: r.id, propertyId: r.property_id, name: r.name, sortOrder: r.sort_order };
    } catch (err) {
      if (uniqueViolation(err)) throw new Error(`Section ${name} already exists at this property`);
      throw err;
    }
  });
}

export async function renameSection(pool: Pool, schema: string, propertyId: string, id: string, name: string): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    try {
      const { rowCount } = await tx.query("update sections set name = $3 where id = $1 and property_id = $2", [id, propertyId, requireText(name, "Name")]);
      if (!rowCount) throw new Error("Section not found");
    } catch (err) {
      if (uniqueViolation(err)) throw new Error(`Section ${name} already exists at this property`);
      throw err;
    }
  });
}

export async function deleteSection(pool: Pool, schema: string, propertyId: string, id: string): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const { rowCount } = await tx.query("delete from sections where id = $1 and property_id = $2", [id, propertyId]);
    if (!rowCount) throw new Error("Section not found");
  });
}

export async function listSections(pool: Pool, schema: string, propertyId: string): Promise<Section[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; property_id: string; name: string; sort_order: number }>(
      "select id, property_id, name, sort_order from sections where property_id = $1 order by sort_order, name",
      [propertyId],
    );
    return rows.map((r) => ({ id: r.id, propertyId: r.property_id, name: r.name, sortOrder: r.sort_order }));
  });
}

export async function createRoomFeature(pool: Pool, schema: string, input: { propertyId: string; code: string; name: string; names?: Names }): Promise<RoomFeature> {
  const code = requireText(input.code, "Code").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const name = requireText(input.name, "Name");
  return withTenant(pool, schema, async (tx) => {
    try {
      const { rows } = await tx.query<{ id: string; property_id: string; code: string; name: string; names: Names }>(
        "insert into room_features (property_id, code, name, names) values ($1, $2, $3, $4) returning id, property_id, code, name, names",
        [input.propertyId, code, name, JSON.stringify(input.names ?? {})],
      );
      const r = rows[0]!;
      return { id: r.id, propertyId: r.property_id, code: r.code, name: r.name, names: r.names ?? {} };
    } catch (err) {
      if (uniqueViolation(err)) throw new Error(`Room Feature ${code} already exists at this property`);
      throw err;
    }
  });
}

export async function updateRoomFeature(pool: Pool, schema: string, propertyId: string, id: string, patch: { name?: string; names?: Names }): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ name: string; names: Names }>("select name, names from room_features where id = $1 and property_id = $2", [id, propertyId]);
    const c = rows[0];
    if (!c) throw new Error("Room Feature not found");
    await tx.query("update room_features set name = $2, names = $3 where id = $1", [
      id,
      patch.name !== undefined ? requireText(patch.name, "Name") : c.name,
      JSON.stringify(patch.names ? mergeNames(c.names ?? {}, patch.names) : (c.names ?? {})),
    ]);
  });
}

export async function deleteRoomFeature(pool: Pool, schema: string, propertyId: string, id: string): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const { rowCount } = await tx.query("delete from room_features where id = $1 and property_id = $2", [id, propertyId]);
    if (!rowCount) throw new Error("Room Feature not found");
  });
}

export async function listRoomFeatures(pool: Pool, schema: string, propertyId: string): Promise<RoomFeature[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; property_id: string; code: string; name: string; names: Names }>(
      "select id, property_id, code, name, names from room_features where property_id = $1 order by name",
      [propertyId],
    );
    return rows.map((r) => ({ id: r.id, propertyId: r.property_id, code: r.code, name: r.name, names: r.names ?? {} }));
  });
}

// ---------- Rooms

const ROOM_SELECT = `select r.id, r.property_id, r.room_type_id, rt.code as room_type_code, rt.name as room_type_name, r.number, r.name, r.names, r.floor, r.section_id,
    s.name as section_name, r.bed_places, r.extra_beds, r.sort_order,
    coalesce((select json_agg(json_build_object('id', f.id, 'code', f.code, 'name', f.name) order by f.name)
              from room_feature_assignments a join room_features f on f.id = a.feature_id where a.room_id = r.id), '[]'::json) as features
  from rooms r join room_types rt on rt.id = r.room_type_id left join sections s on s.id = r.section_id`;

interface RoomRow {
  id: string;
  property_id: string;
  room_type_id: string;
  room_type_code: string;
  room_type_name: string;
  number: string;
  name: string;
  names: Names;
  floor: string;
  section_id: string | null;
  section_name: string | null;
  bed_places: number;
  extra_beds: number;
  sort_order: number;
  features: { id: string; code: string; name: string }[];
}

function toRoom(r: RoomRow): Room {
  return {
    id: r.id,
    propertyId: r.property_id,
    roomTypeId: r.room_type_id,
    roomTypeCode: r.room_type_code,
    roomTypeName: r.room_type_name,
    number: r.number,
    name: r.name,
    names: r.names ?? {},
    floor: r.floor,
    sectionId: r.section_id,
    sectionName: r.section_name,
    bedPlaces: r.bed_places,
    extraBeds: r.extra_beds,
    sortOrder: r.sort_order,
    features: r.features,
  };
}

/** Today in the property's time zone; `param` is the statement parameter holding the property id. */
const propertyToday = (param: string) => `(now() at time zone (select time_zone from properties where id = ${param}))::date`;

async function assertSectionAtProperty(tx: PoolClient, sectionId: string | null, propertyId: string): Promise<void> {
  if (!sectionId) return;
  const { rowCount } = await tx.query("select 1 from sections where id = $1 and property_id = $2", [sectionId, propertyId]);
  if (!rowCount) throw new Error("Section not found at this property");
}

/** Natural order for room numbers: 101, 102, 110, 2A, 2B. */
function roomSortKey(number: string): number {
  const digits = /^\d+/.exec(number)?.[0];
  return digits ? Number(digits) : Number.MAX_SAFE_INTEGER;
}

/**
 * Create rooms of one Room Type in one go, with the type's bed defaults and a
 * first capacity history entry. All or nothing: a duplicate number fails the batch.
 */
export async function createRooms(
  pool: Pool,
  schema: string,
  input: { propertyId: string; roomTypeId: string; numbers: string[]; floor?: string; sectionId?: string | null; bedPlaces?: number; extraBeds?: number },
): Promise<Room[]> {
  const numbers = [...new Set(input.numbers.map((n) => n.trim()).filter(Boolean))];
  if (numbers.length === 0) throw new Error("At least one room number is required");
  if (numbers.length > 1000) throw new Error("At most 1000 rooms at a time");
  return withTenant(pool, schema, async (tx) => {
    const type = await tx.query<{ bed_places: number; extra_beds: number; property_id: string }>("select bed_places, extra_beds, property_id from room_types where id = $1", [input.roomTypeId]);
    const t = type.rows[0];
    if (!t || t.property_id !== input.propertyId) throw new Error("Room Type not found at this property");
    await assertSectionAtProperty(tx, input.sectionId ?? null, input.propertyId);
    const bedPlaces = requireInt(input.bedPlaces ?? t.bed_places, "Bed places", 0);
    const extraBeds = requireInt(input.extraBeds ?? t.extra_beds, "Extra beds", 0);
    let ids: string[];
    try {
      const { rows } = await tx.query<{ id: string }>(
        `insert into rooms (property_id, room_type_id, number, floor, section_id, bed_places, extra_beds, sort_order)
         select $1, $2, n.number, $4, $5, $6, $7, n.sort_order from unnest($3::text[], $8::int[]) as n(number, sort_order)
         returning id`,
        [input.propertyId, input.roomTypeId, numbers, input.floor ?? "", input.sectionId ?? null, bedPlaces, extraBeds, numbers.map(roomSortKey)],
      );
      ids = rows.map((r) => r.id);
    } catch (err) {
      if (uniqueViolation(err)) throw new Error("A room with one of these numbers already exists at this property");
      throw err;
    }
    // First capacity row, dated in the property's own calendar.
    await tx.query(
      `insert into room_capacity_history (room_id, valid_from, bed_places, extra_beds)
       select id, ${propertyToday("$4")}, $2, $3 from unnest($1::uuid[]) as id`,
      [ids, bedPlaces, extraBeds, input.propertyId],
    );
    const { rows } = await tx.query<RoomRow>(`${ROOM_SELECT} where r.id = any($1::uuid[]) order by r.sort_order, r.number`, [ids]);
    return rows.map(toRoom);
  });
}

export interface RoomPatch {
  number?: string;
  name?: string;
  names?: Names;
  floor?: string;
  roomTypeId?: string;
  sectionId?: string | null;
  featureIds?: string[];
  bedPlaces?: number;
  extraBeds?: number;
  /** Date (YYYY-MM-DD) the new bed places and extra beds count from; today when omitted. */
  validFrom?: string;
}

export async function updateRoom(pool: Pool, schema: string, propertyId: string, id: string, patch: RoomPatch): Promise<Room> {
  return withTenant(pool, schema, async (tx) => {
    const current = await tx.query<RoomRow>(`${ROOM_SELECT} where r.id = $1 and r.property_id = $2`, [id, propertyId]);
    const c = current.rows[0];
    if (!c) throw new Error("Room not found");
    if (patch.sectionId) await assertSectionAtProperty(tx, patch.sectionId, propertyId);
    const number = patch.number !== undefined ? requireText(patch.number, "Room number") : c.number;
    const bedPlaces = patch.bedPlaces !== undefined ? requireInt(patch.bedPlaces, "Bed places", 0) : c.bed_places;
    const extraBeds = patch.extraBeds !== undefined ? requireInt(patch.extraBeds, "Extra beds", 0) : c.extra_beds;
    if (patch.roomTypeId !== undefined) {
      const t = await tx.query("select 1 from room_types where id = $1 and property_id = $2", [patch.roomTypeId, c.property_id]);
      if (!t.rowCount) throw new Error("Room Type not found at this property");
    }
    try {
      await tx.query(
        `update rooms set number = $2, name = $3, names = $4, floor = $5, room_type_id = $6, section_id = $7, sort_order = $8, updated_at = now() where id = $1`,
        [
          id,
          number,
          patch.name !== undefined ? patch.name.trim() : c.name,
          JSON.stringify(patch.names ? mergeNames(c.names ?? {}, patch.names) : (c.names ?? {})),
          patch.floor ?? c.floor,
          patch.roomTypeId ?? c.room_type_id,
          patch.sectionId === undefined ? c.section_id : patch.sectionId,
          roomSortKey(number),
        ],
      );
    } catch (err) {
      if (uniqueViolation(err)) throw new Error(`Room ${number} already exists at this property`);
      throw err;
    }
    if (bedPlaces !== c.bed_places || extraBeds !== c.extra_beds || patch.validFrom) {
      // The history is the truth; the room's current counts follow the row in effect today.
      await tx.query(
        `insert into room_capacity_history (room_id, valid_from, bed_places, extra_beds) values ($1, coalesce($2::date, ${propertyToday("$5")}), $3, $4)
         on conflict (room_id, valid_from) do update set bed_places = excluded.bed_places, extra_beds = excluded.extra_beds`,
        [id, patch.validFrom ?? null, bedPlaces, extraBeds, propertyId],
      );
      await tx.query(
        `update rooms r set bed_places = h.bed_places, extra_beds = h.extra_beds
           from (select bed_places, extra_beds from room_capacity_history where room_id = $1 and valid_from <= ${propertyToday("$2")} order by valid_from desc limit 1) h
          where r.id = $1`,
        [id, propertyId],
      );
    }
    if (patch.featureIds) {
      await tx.query("delete from room_feature_assignments where room_id = $1 and not (feature_id = any($2::uuid[]))", [id, patch.featureIds]);
      for (const f of patch.featureIds) {
        await tx.query("insert into room_feature_assignments (room_id, feature_id) select $1, $2 where exists (select 1 from room_features where id = $2 and property_id = $3) on conflict do nothing", [id, f, c.property_id]);
      }
    }
    const found = await tx.query<RoomRow>(`${ROOM_SELECT} where r.id = $1`, [id]);
    return toRoom(found.rows[0]!);
  });
}

export async function deleteRoom(pool: Pool, schema: string, propertyId: string, id: string): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const { rowCount } = await tx.query("delete from rooms where id = $1 and property_id = $2", [id, propertyId]);
    if (!rowCount) throw new Error("Room not found");
  });
}

export async function listRooms(pool: Pool, schema: string, propertyId: string): Promise<Room[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<RoomRow>(`${ROOM_SELECT} where r.property_id = $1 order by r.sort_order, r.number`, [propertyId]);
    return rows.map(toRoom);
  });
}

export async function roomCapacityHistory(pool: Pool, schema: string, roomId: string): Promise<{ validFrom: string; bedPlaces: number; extraBeds: number }[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ valid_from: string; bed_places: number; extra_beds: number }>(
      "select to_char(valid_from, 'YYYY-MM-DD') as valid_from, bed_places, extra_beds from room_capacity_history where room_id = $1 order by valid_from",
      [roomId],
    );
    return rows.map((r) => ({ validFrom: r.valid_from, bedPlaces: r.bed_places, extraBeds: r.extra_beds }));
  });
}

// ---------- Age Bands

/** Carries the problem code so the screen can show it in the user's language. */
export class AgeBandError extends Error {
  constructor(
    public readonly problem: AgeBandIssue["problem"],
    public readonly bandName: string,
  ) {
    super(`Age Bands: ${problem}${bandName ? ` (${bandName})` : ""}`);
    this.name = "AgeBandError";
  }
}

/** Replace the property's Age Bands as a whole; refused unless they cover every age exactly once. */
export async function saveAgeBands(pool: Pool, schema: string, propertyId: string, bands: AgeBandInput[]): Promise<AgeBand[]> {
  for (const b of bands) {
    requireInt(b.minAge, "From age", 0);
    if (b.maxAge !== null) requireInt(b.maxAge, "To age", 0);
  }
  const issues = validateAgeBands(bands);
  if (issues.length) {
    const first = issues[0]!;
    throw new AgeBandError(first.problem, first.index >= 0 ? (bands[first.index]?.name ?? "") : "");
  }
  return withTenant(pool, schema, async (tx) => {
    await tx.query("delete from age_bands where property_id = $1", [propertyId]);
    const sorted = [...bands].sort((a, b) => a.minAge - b.minAge);
    for (const [i, b] of sorted.entries()) {
      await tx.query("insert into age_bands (property_id, name, min_age, max_age, sort_order) values ($1, $2, $3, $4, $5)", [propertyId, requireText(b.name, "Name"), b.minAge, b.maxAge, i]);
    }
    return listAgeBandsTx(tx, propertyId);
  });
}

async function listAgeBandsTx(tx: PoolClient, propertyId: string): Promise<AgeBand[]> {
  const { rows } = await tx.query<{ id: string; property_id: string; name: string; min_age: number; max_age: number | null }>(
    "select id, property_id, name, min_age, max_age from age_bands where property_id = $1 order by min_age",
    [propertyId],
  );
  return rows.map((r) => ({ id: r.id, propertyId: r.property_id, name: r.name, minAge: r.min_age, maxAge: r.max_age }));
}

export async function listAgeBands(pool: Pool, schema: string, propertyId: string): Promise<AgeBand[]> {
  return withTenant(pool, schema, (tx) => listAgeBandsTx(tx, propertyId));
}
