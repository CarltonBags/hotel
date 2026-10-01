import type { Pool, PoolClient } from "pg";
import { isPostingRhythm, mergeNames, type Names, type PostingRhythm } from "@hoteloftware/domain";
import { normaliseCode, uniqueViolation } from "./catalogue-common";
import { withTenant } from "./with-tenant";

export interface ServiceInput {
  propertyId: string;
  code: string;
  name: string;
  names?: Names;
  defaultPrice: number;
  taxCodeId: string;
  revenueAccount: string;
  postingRhythm: PostingRhythm;
  bookableOnline: boolean;
  active?: boolean;
  sortOrder?: number;
}

export interface Service extends Omit<ServiceInput, "names" | "active" | "sortOrder"> {
  id: string;
  names: Names;
  active: boolean;
  sortOrder: number;
  taxCodeCode: string;
  taxCodeName: string;
  currentTaxRate: number | null;
}

/** Fields a Revenue user may change versus fields Accounting may change; Property Manager both. */
export type ServicePatch = Partial<Omit<ServiceInput, "propertyId">>;

function checkPrice(price: number): number {
  if (!Number.isFinite(price) || price < 0) throw new Error("Price must be zero or more");
  return Math.round(price * 100) / 100;
}

interface Row {
  id: string;
  property_id: string;
  code: string;
  name: string;
  names: Names;
  default_price: string;
  tax_code_id: string;
  tax_code_code: string;
  tax_code_name: string;
  current_rate: string | null;
  revenue_account: string;
  posting_rhythm: PostingRhythm;
  bookable_online: boolean;
  active: boolean;
  sort_order: number;
}

/** Current rate is the one in force on the property's own date. */
const SELECT = `select s.id, s.property_id, s.code, s.name, s.names, s.default_price, s.tax_code_id, t.code as tax_code_code, t.name as tax_code_name,
    (select r.rate from tax_code_rates r
      where r.tax_code_id = t.id and r.valid_from <= (now() at time zone p.time_zone)::date
      order by r.valid_from desc limit 1) as current_rate,
    s.revenue_account, s.posting_rhythm, s.bookable_online, s.active, s.sort_order
  from services s join tax_codes t on t.id = s.tax_code_id join properties p on p.id = s.property_id`;

function toService(r: Row): Service {
  return {
    id: r.id,
    propertyId: r.property_id,
    code: r.code,
    name: r.name,
    names: r.names ?? {},
    defaultPrice: Number(r.default_price),
    taxCodeId: r.tax_code_id,
    taxCodeCode: r.tax_code_code,
    taxCodeName: r.tax_code_name,
    currentTaxRate: r.current_rate === null ? null : Number(r.current_rate),
    revenueAccount: r.revenue_account,
    postingRhythm: r.posting_rhythm,
    bookableOnline: r.bookable_online,
    active: r.active,
    sortOrder: r.sort_order,
  };
}

/** A Tax Code may only be used by properties of the Legal Entity that owns it. */
async function assertTaxCodeForProperty(tx: PoolClient, taxCodeId: string, propertyId: string): Promise<void> {
  const { rowCount } = await tx.query(
    "select 1 from tax_codes t join properties p on p.legal_entity_id = t.legal_entity_id where t.id = $1 and p.id = $2",
    [taxCodeId, propertyId],
  );
  if (!rowCount) throw new Error("Tax Code does not belong to this property's Legal Entity");
}

export async function createService(pool: Pool, schema: string, input: ServiceInput): Promise<Service> {
  const code = normaliseCode(input.code);
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  if (!isPostingRhythm(input.postingRhythm)) throw new Error("Unknown posting rhythm");
  const price = checkPrice(input.defaultPrice);
  return withTenant(pool, schema, async (tx) => {
    await assertTaxCodeForProperty(tx, input.taxCodeId, input.propertyId);
    try {
      const { rows } = await tx.query<{ id: string }>(
        `insert into services (property_id, code, name, names, default_price, tax_code_id, revenue_account, posting_rhythm, bookable_online, active, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11, (select coalesce(max(sort_order), 0) + 1 from services where property_id = $1)))
         returning id`,
        [input.propertyId, code, name, JSON.stringify(input.names ?? {}), price, input.taxCodeId, input.revenueAccount.trim(), input.postingRhythm, input.bookableOnline, input.active ?? true, input.sortOrder ?? null],
      );
      const found = await tx.query<Row>(`${SELECT} where s.id = $1`, [rows[0]!.id]);
      return toService(found.rows[0]!);
    } catch (err) {
      if (uniqueViolation(err)) throw new Error(`Service ${code} already exists at this property`);
      throw err;
    }
  });
}

export async function updateService(pool: Pool, schema: string, propertyId: string, id: string, patch: ServicePatch): Promise<Service> {
  return withTenant(pool, schema, async (tx) => {
    const current = await tx.query<Row>(`${SELECT} where s.id = $1 and s.property_id = $2`, [id, propertyId]);
    const c = current.rows[0];
    if (!c) throw new Error("Service not found");
    if (patch.taxCodeId !== undefined) await assertTaxCodeForProperty(tx, patch.taxCodeId, propertyId);
    if (patch.postingRhythm !== undefined && !isPostingRhythm(patch.postingRhythm)) throw new Error("Unknown posting rhythm");
    const code = patch.code !== undefined ? normaliseCode(patch.code) : c.code;
    const name = patch.name !== undefined ? patch.name.trim() : c.name;
    if (!name) throw new Error("Name is required");
    try {
      await tx.query(
        `update services set code = $3, name = $4, names = $5, default_price = $6, tax_code_id = $7, revenue_account = $8, posting_rhythm = $9,
           bookable_online = $10, active = $11, sort_order = $12, updated_at = now()
         where id = $1 and property_id = $2`,
        [
          id,
          propertyId,
          code,
          name,
          JSON.stringify(patch.names ? mergeNames(c.names ?? {}, patch.names) : (c.names ?? {})),
          patch.defaultPrice !== undefined ? checkPrice(patch.defaultPrice) : Number(c.default_price),
          patch.taxCodeId ?? c.tax_code_id,
          patch.revenueAccount !== undefined ? patch.revenueAccount.trim() : c.revenue_account,
          patch.postingRhythm ?? c.posting_rhythm,
          patch.bookableOnline ?? c.bookable_online,
          patch.active ?? c.active,
          patch.sortOrder ?? c.sort_order,
        ],
      );
    } catch (err) {
      if (uniqueViolation(err)) throw new Error(`Service ${code} already exists at this property`);
      throw err;
    }
    const found = await tx.query<Row>(`${SELECT} where s.id = $1`, [id]);
    return toService(found.rows[0]!);
  });
}

export async function listServices(pool: Pool, schema: string, propertyId: string, options: { includeInactive?: boolean } = {}): Promise<Service[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<Row>(
      `${SELECT} where s.property_id = $1 ${options.includeInactive ? "" : "and s.active"} order by s.sort_order, s.code`,
      [propertyId],
    );
    return rows.map(toService);
  });
}

export async function findService(pool: Pool, schema: string, propertyId: string, id: string): Promise<Service | null> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<Row>(`${SELECT} where s.id = $1 and s.property_id = $2`, [id, propertyId]);
    return rows[0] ? toService(rows[0]) : null;
  });
}
