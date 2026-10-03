import type { Pool } from "pg";
import { isCountryCode, isCurrencyCode, isTimeZone } from "@hoteloftware/domain";
import { withTenant } from "./with-tenant";

export interface PropertyInput {
  name: string;
  legalEntityId: string;
  country: string;
  timeZone: string;
  currency: string;
}

export interface Property extends PropertyInput {
  id: string;
  legalEntityName: string;
  createdAt: Date;
  /** Front Desk refunds up to this amount; above it Approval is needed (ticket 27). */
  refundLimit: number;
}

interface Row {
  id: string;
  name: string;
  legal_entity_id: string;
  legal_entity_name: string;
  country: string;
  time_zone: string;
  currency: string;
  created_at: Date;
  refund_limit: string;
}

const SELECT = `select p.id, p.name, p.legal_entity_id, l.name as legal_entity_name, p.country, p.time_zone, p.currency, p.created_at, p.refund_limit
                from properties p join legal_entities l on l.id = p.legal_entity_id`;

function toProperty(r: Row): Property {
  return {
    id: r.id,
    name: r.name,
    legalEntityId: r.legal_entity_id,
    legalEntityName: r.legal_entity_name,
    country: r.country,
    timeZone: r.time_zone,
    currency: r.currency,
    createdAt: r.created_at,
    refundLimit: Number(r.refund_limit),
  };
}

function validate(input: PropertyInput): void {
  if (!input.name.trim()) throw new Error("A Property needs a name");
  if (!isCountryCode(input.country)) throw new Error(`Unknown country: ${input.country}`);
  if (!isTimeZone(input.timeZone)) throw new Error(`Unknown time zone: ${input.timeZone}`);
  if (!isCurrencyCode(input.currency)) throw new Error(`Unknown currency: ${input.currency}`);
}

export async function createProperty(pool: Pool, schema: string, input: PropertyInput): Promise<Property> {
  validate(input);
  return withTenant(pool, schema, async (tx) => {
    const le = await tx.query("select 1 from legal_entities where id = $1", [input.legalEntityId]);
    if (!le.rowCount) throw new Error("Legal Entity not found");
    const { rows } = await tx.query<{ id: string }>(
      `insert into properties (name, legal_entity_id, country, time_zone, currency) values ($1, $2, $3, $4, $5) returning id`,
      [input.name.trim(), input.legalEntityId, input.country, input.timeZone, input.currency],
    );
    const found = await tx.query<Row>(`${SELECT} where p.id = $1`, [rows[0]!.id]);
    return toProperty(found.rows[0]!);
  });
}

export async function updateProperty(pool: Pool, schema: string, id: string, input: PropertyInput): Promise<Property> {
  validate(input);
  return withTenant(pool, schema, async (tx) => {
    const le = await tx.query("select 1 from legal_entities where id = $1", [input.legalEntityId]);
    if (!le.rowCount) throw new Error("Legal Entity not found");
    const updated = await tx.query(
      `update properties set name = $2, legal_entity_id = $3, country = $4, time_zone = $5, currency = $6, updated_at = now() where id = $1`,
      [id, input.name.trim(), input.legalEntityId, input.country, input.timeZone, input.currency],
    );
    if (!updated.rowCount) throw new Error("Property not found");
    const found = await tx.query<Row>(`${SELECT} where p.id = $1`, [id]);
    return toProperty(found.rows[0]!);
  });
}

export async function listProperties(pool: Pool, schema: string): Promise<Property[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<Row>(`${SELECT} order by p.name`);
    return rows.map(toProperty);
  });
}

export async function findProperty(pool: Pool, schema: string, id: string): Promise<Property | null> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<Row>(`${SELECT} where p.id = $1`, [id]);
    return rows[0] ? toProperty(rows[0]) : null;
  });
}
