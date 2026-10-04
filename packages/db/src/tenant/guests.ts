import type { Pool, PoolClient } from "pg";
import { DOCUMENT_TYPES, EMPTY_GUEST, SALUTATIONS, isOneOf, mergeGuestData, normaliseEmail, normalisePhone, phoneSearchDigits, type GuestData } from "@hoteloftware/domain";
import { checkDate, isUuid } from "./catalogue-common";
import { withTenant } from "./with-tenant";

/**
 * Guest profiles are tenant-wide (ADR 0004): one profile is known at every
 * property, with duplicate detection at creation and manual merge.
 */

export type GuestInput = Partial<GuestData> & { lastName: string };
export type GuestPatch = Partial<GuestData>;

export interface Guest extends GuestData {
  id: string;
  createdAt: Date;
  createdPropertyId: string | null;
  updatedAt: Date;
}

export interface GuestSummary {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  countryOfResidence: string | null;
  email: string | null;
  phone: string | null;
  vip: boolean;
}

export type DuplicateReason = "email" | "phone" | "name_and_birth_date";
export interface GuestDuplicate extends GuestSummary {
  reasons: DuplicateReason[];
}

/** Profile field → column; one map for reading, writing, history and merge. */
const COLUMNS: Record<keyof GuestData, string> = {
  salutation: "salutation",
  firstName: "first_name",
  lastName: "last_name",
  dateOfBirth: "date_of_birth",
  placeOfBirth: "place_of_birth",
  nationality: "nationality",
  countryOfResidence: "country_of_residence",
  postalCode: "postal_code",
  addressLine1: "address_line1",
  addressLine2: "address_line2",
  city: "city",
  region: "region",
  email: "email",
  phone: "phone",
  language: "language",
  preferences: "preferences",
  vip: "vip",
  marketingConsent: "marketing_consent",
  marketingConsentAt: "marketing_consent_at",
  marketingConsentSource: "marketing_consent_source",
  documentType: "document_type",
  documentNumber: "document_number",
  documentCountry: "document_country",
  documentExpiry: "document_expiry",
};
const FIELDS = Object.keys(COLUMNS) as (keyof GuestData)[];
const DATE_FIELDS = new Set<keyof GuestData>(["dateOfBirth", "documentExpiry"]);
const COUNTRY_FIELDS = new Set<keyof GuestData>(["nationality", "countryOfResidence", "documentCountry"]);

const SELECT = `select id, ${FIELDS.map((f) =>
  DATE_FIELDS.has(f) ? `to_char(${COLUMNS[f]}, 'YYYY-MM-DD') as ${COLUMNS[f]}` : f === "marketingConsentAt" ? `${COLUMNS[f]}` : COLUMNS[f],
).join(", ")}, created_at, created_property_id, updated_at from guests`;

type Row = Record<string, unknown> & { id: string; created_at: Date; created_property_id: string | null; updated_at: Date };

function toGuest(r: Row): Guest {
  const g = { id: r.id, createdAt: r.created_at, createdPropertyId: r.created_property_id, updatedAt: r.updated_at } as Guest;
  for (const f of FIELDS) {
    const v = r[COLUMNS[f]];
    (g as unknown as Record<string, unknown>)[f] = f === "marketingConsentAt" ? (v instanceof Date ? v.toISOString() : (v ?? null)) : typeof v === "string" ? v.trimEnd() : (v ?? null);
  }
  return g;
}

function toSummary(g: Guest): GuestSummary {
  return { id: g.id, firstName: g.firstName, lastName: g.lastName, dateOfBirth: g.dateOfBirth, countryOfResidence: g.countryOfResidence, email: g.email, phone: g.phone, vip: g.vip };
}

/** Validate and normalise one profile's data; text fields trimmed, empty optional fields become null. */
function clean(data: GuestData): GuestData {
  const out = { ...data };
  const text = (v: string | null) => {
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  };
  out.firstName = (data.firstName ?? "").trim();
  out.lastName = (data.lastName ?? "").trim();
  if (!out.lastName) throw new Error("Last name is required");
  out.addressLine1 = (data.addressLine1 ?? "").trim();
  out.addressLine2 = (data.addressLine2 ?? "").trim();
  out.city = (data.city ?? "").trim();
  out.region = (data.region ?? "").trim();
  out.salutation = text(data.salutation) as GuestData["salutation"];
  if (out.salutation !== null && !isOneOf(SALUTATIONS, out.salutation)) throw new Error("Unknown salutation");
  out.preferences = (data.preferences ?? "").trim();
  for (const f of ["postalCode", "email", "phone", "language", "marketingConsentSource", "documentNumber", "placeOfBirth"] as const) out[f] = text(data[f]);
  for (const f of COUNTRY_FIELDS) {
    const v = text(data[f] as string | null)?.toUpperCase() ?? null;
    if (v !== null && !/^[A-Z]{2}$/.test(v)) throw new Error("Countries are two-letter codes");
    (out as unknown as Record<string, unknown>)[f] = v;
  }
  for (const f of DATE_FIELDS) {
    const v = text(data[f] as string | null);
    (out as unknown as Record<string, unknown>)[f] = v === null ? null : checkDate(v);
  }
  if (out.email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new Error("Email address looks wrong");
  if (out.documentType !== null && !isOneOf(DOCUMENT_TYPES, out.documentType)) throw new Error("Unknown document type");
  if (out.marketingConsent) {
    if (!out.marketingConsentAt || !out.marketingConsentSource) throw new Error("Marketing consent needs its proof: when and how it was given");
  } else {
    out.marketingConsentAt = null;
    out.marketingConsentSource = null;
  }
  return out;
}

const EMPTY = EMPTY_GUEST;

function values(d: GuestData): unknown[] {
  return [...FIELDS.map((f) => d[f]), normaliseEmail(d.email), normalisePhone(d.phone)];
}

export async function createGuest(pool: Pool, schema: string, input: GuestInput, ctx: { userId: string; propertyId: string | null }): Promise<Guest> {
  const data = clean({ ...EMPTY, ...input });
  return withTenant(pool, schema, async (tx) => {
    const cols = [...FIELDS.map((f) => COLUMNS[f]), "email_normalised", "phone_normalised", "created_by", "created_property_id"];
    const params = [...values(data), ctx.userId, ctx.propertyId];
    const { rows } = await tx.query<{ id: string }>(`insert into guests (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, params);
    return (await loadGuest(tx, rows[0]!.id))!;
  });
}

export async function loadGuest(tx: PoolClient, id: string, options: { lock?: boolean } = {}): Promise<Guest | null> {
  if (!isUuid(id)) return null;
  const { rows } = await tx.query<Row>(`${SELECT} where id = $1${options.lock ? " for update" : ""}`, [id]);
  return rows[0] ? toGuest(rows[0]) : null;
}

const show = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

async function writeGuest(tx: PoolClient, current: Guest, next: GuestData, userId: string): Promise<void> {
  const changed = FIELDS.filter((f) => show(current[f]) !== show(next[f]));
  if (changed.length === 0) return;
  await tx.query(
    `update guests set ${FIELDS.map((f, i) => `${COLUMNS[f]} = $${i + 2}`).join(", ")}, email_normalised = $${FIELDS.length + 2}, phone_normalised = $${FIELDS.length + 3}, updated_at = now() where id = $1`,
    [current.id, ...values(next)],
  );
  for (const f of changed) {
    await tx.query("insert into guest_changes (guest_id, user_id, field, old_value, new_value) values ($1, $2, $3, $4, $5)", [current.id, userId, f, show(current[f]), show(next[f])]);
  }
}

export async function updateGuest(pool: Pool, schema: string, id: string, patch: GuestPatch, ctx: { userId: string }): Promise<Guest> {
  return withTenant(pool, schema, async (tx) => {
    // locked: a concurrent save or merge must not be overwritten with an old snapshot
    const current = await loadGuest(tx, id, { lock: true });
    if (!current) throw new Error("Guest not found");
    const next = clean({ ...current, ...patch });
    await writeGuest(tx, current, next, ctx.userId);
    return (await loadGuest(tx, id))!;
  });
}

export async function findGuest(pool: Pool, schema: string, id: string): Promise<Guest | null> {
  return withTenant(pool, schema, (tx) => loadGuest(tx, id));
}

/**
 * Tenant-wide search by name, email or phone. Every word must match one of
 * them; digits also match the normalised phone.
 */
export async function searchGuests(pool: Pool, schema: string, query: string, options: { limit?: number } = {}): Promise<GuestSummary[]> {
  const limit = options.limit ?? 30;
  const trimmed = query.trim();
  // a phone number typed with spaces is one term, not several words
  const words = /^[\d\s+()/.-]+$/.test(trimmed) ? [trimmed] : trimmed.split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.length === 0 || words[0] === "") return [];
  return withTenant(pool, schema, async (tx) => {
    const like = words.map((w) => `%${w.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const params: string[] = [...like];
    const conditions = words.map((w, i) => {
      const names = `lower(first_name) like $${i + 1} or lower(last_name) like $${i + 1}`;
      const digits = phoneSearchDigits(w);
      let phone = "";
      if (digits.length >= 4) {
        params.push(digits);
        phone = ` or phone_normalised like '%' || $${params.length} || '%'`;
      }
      return `(${names} or email_normalised like $${i + 1}${phone})`;
    });
    const { rows } = await tx.query<Row>(`${SELECT} where ${conditions.join(" and ")} order by lower(last_name), lower(first_name) limit ${Math.min(limit, 100)}`, params);
    return rows.map((r) => toSummary(toGuest(r)));
  });
}

/** Possible duplicates of a profile about to be created: same email, same phone, or same name and date of birth. */
export async function findGuestDuplicates(pool: Pool, schema: string, input: Partial<GuestData>, excludeId?: string): Promise<GuestDuplicate[]> {
  const email = normaliseEmail(input.email);
  const phone = normalisePhone(input.phone);
  const first = (input.firstName ?? "").trim().toLowerCase();
  const last = (input.lastName ?? "").trim().toLowerCase();
  const dob = input.dateOfBirth ? checkDate(input.dateOfBirth) : null;
  if (!email && !phone && !(last && dob)) return [];
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<Row & { by_email: boolean; by_phone: boolean; by_name: boolean }>(
      `select * from (
         select g.*, coalesce(x.email_normalised = $1, false) as by_email, coalesce(x.phone_normalised = $2, false) as by_phone,
           coalesce($5::date is not null and lower(x.last_name) = $4 and lower(x.first_name) = $3 and x.date_of_birth = $5::date, false) as by_name
         from (${SELECT}) g join guests x on x.id = g.id
       ) c where (by_email or by_phone or by_name) and ($6::uuid is null or c.id <> $6) order by lower(c.last_name) limit 10`,
      [email, phone, first, last, dob, excludeId ?? null],
    );
    return rows.map((r) => ({
      ...toSummary(toGuest(r)),
      reasons: [r.by_email && "email", r.by_phone && "phone", r.by_name && "name_and_birth_date"].filter((x): x is DuplicateReason => Boolean(x)),
    }));
  });
}

export interface GuestChange {
  userId: string;
  at: Date;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export async function guestHistory(pool: Pool, schema: string, guestId: string): Promise<GuestChange[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ user_id: string; at: Date; field: string; old_value: string | null; new_value: string | null }>(
      "select user_id, at, field, old_value, new_value from guest_changes where guest_id = $1 order by at desc limit 200",
      [guestId],
    );
    return rows.map((r) => ({ userId: r.user_id, at: r.at, field: r.field, oldValue: r.old_value, newValue: r.new_value }));
  });
}

export interface GuestMerge {
  keptId: string;
  mergedId: string;
  userId: string;
  at: Date;
  filledFields: string[];
  movedRecords: number;
}

/**
 * Merge `mergeId` into `keepId`: the kept profile keeps its values and fills
 * gaps from the other (domain mergeGuestData); every row in the tenant schema
 * that points at the merged profile through a foreign key is moved to the
 * kept one, so stay history from any property comes along; the merged
 * profile is deleted and the merge logged (ids and field names, no data).
 */
export async function mergeGuests(pool: Pool, schema: string, ids: { keepId: string; mergeId: string }, ctx: { userId: string }): Promise<Guest> {
  if (ids.keepId === ids.mergeId) throw new Error("A profile cannot be merged with itself");
  if (!isUuid(ids.keepId) || !isUuid(ids.mergeId)) throw new Error("Guest not found");
  return withTenant(pool, schema, async (tx) => {
    const locked = await tx.query("select id from guests where id = any($1::uuid[]) order by id for update", [[ids.keepId, ids.mergeId]]);
    if (locked.rowCount !== 2) throw new Error("Guest not found");
    const keep = (await loadGuest(tx, ids.keepId))!;
    const other = (await loadGuest(tx, ids.mergeId))!;
    const merged = mergeGuestData(keep, other);
    const filled = FIELDS.filter((f) => show(keep[f]) !== show(merged[f]));

    // every foreign key into guests within this tenant schema, except the profile's own history
    const refs = await tx.query<{ table_name: string; column_name: string; columns: number }>(
      `select quote_ident(c.relname) as table_name, quote_ident(a.attname) as column_name, array_length(k.conkey, 1) as columns
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid
       join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
       where k.contype = 'f' and k.confrelid = 'guests'::regclass
         and c.relnamespace = (select oid from pg_namespace where nspname = current_schema())
         and c.relname <> 'guest_changes'`,
    );
    // fail loudly rather than let a cascade delete what a merge cannot move
    if (refs.rows.some((r) => r.columns !== 1)) throw new Error("A record points at guests through several columns; merge cannot move it");
    let moved = 0;
    for (const r of refs.rows) {
      // identifiers come from the catalogue, quoted by Postgres
      try {
        const res = await tx.query(`update ${r.table_name} set ${r.column_name} = $1 where ${r.column_name} = $2`, [ids.keepId, ids.mergeId]);
        moved += res.rowCount ?? 0;
      } catch (err) {
        if ((err as { code?: string }).code === "23505") throw new Error("Both profiles are on the same record (for example one reservation); remove one of them there first");
        throw err;
      }
    }
    await writeGuest(tx, keep, clean(merged), ctx.userId);
    await tx.query("update guest_changes set guest_id = $1 where guest_id = $2", [ids.keepId, ids.mergeId]);
    // merges the absorbed profile had made stay in the kept profile's log
    await tx.query("update guest_merges set kept_id = $1 where kept_id = $2", [ids.keepId, ids.mergeId]);
    await tx.query("delete from guests where id = $1", [ids.mergeId]);
    await tx.query("insert into guest_merges (kept_id, merged_id, user_id, filled_fields, moved_records) values ($1, $2, $3, $4, $5)", [ids.keepId, ids.mergeId, ctx.userId, filled, moved]);
    return (await loadGuest(tx, ids.keepId))!;
  });
}

export async function listGuestMerges(pool: Pool, schema: string, guestId: string): Promise<GuestMerge[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ kept_id: string; merged_id: string; user_id: string; at: Date; filled_fields: string[]; moved_records: number }>(
      "select kept_id, merged_id, user_id, at, filled_fields, moved_records from guest_merges where kept_id = $1 order by at desc",
      [guestId],
    );
    return rows.map((r) => ({ keptId: r.kept_id, mergedId: r.merged_id, userId: r.user_id, at: r.at, filledFields: r.filled_fields, movedRecords: r.moved_records }));
  });
}
