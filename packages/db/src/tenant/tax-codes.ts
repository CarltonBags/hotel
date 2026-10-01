import type { Pool, PoolClient } from "pg";
import { TAX_PRESETS, isTaxPresetCountry, taxRateOn, type DatedRate } from "@hoteloftware/domain";
import { PRESET_RATE_START, checkDate, normaliseCode, uniqueViolation } from "./catalogue-common";
import { withTenant } from "./with-tenant";

export interface TaxCode {
  id: string;
  legalEntityId: string;
  code: string;
  name: string;
  rates: DatedRate[];
  /** Rate in force on the date the caller passed as "today" (the property's own date). */
  currentRate: number | null;
}

function serverToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function checkRate(rate: number): number {
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error("Rate must be between 0 and 100 percent");
  return Math.round(rate * 100) / 100;
}

interface Row {
  id: string;
  legal_entity_id: string;
  code: string;
  name: string;
  rates: { valid_from: string; rate: string }[];
}

const SELECT = `select t.id, t.legal_entity_id, t.code, t.name,
    coalesce((select json_agg(json_build_object('valid_from', to_char(r.valid_from, 'YYYY-MM-DD'), 'rate', r.rate) order by r.valid_from)
              from tax_code_rates r where r.tax_code_id = t.id), '[]'::json) as rates
  from tax_codes t`;

function toTaxCode(r: Row, today: string): TaxCode {
  const rates = r.rates.map((x) => ({ validFrom: x.valid_from, rate: Number(x.rate) }));
  return { id: r.id, legalEntityId: r.legal_entity_id, code: r.code, name: r.name, rates, currentRate: taxRateOn(rates, today) };
}

export async function listTaxCodes(pool: Pool, schema: string, legalEntityId: string, options: { today?: string } = {}): Promise<TaxCode[]> {
  const today = options.today ?? serverToday();
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<Row>(`${SELECT} where t.legal_entity_id = $1 order by t.code`, [legalEntityId]);
    return rows.map((r) => toTaxCode(r, today));
  });
}

async function insertTaxCode(tx: PoolClient, legalEntityId: string, input: { code: string; name: string; rates: DatedRate[] }): Promise<TaxCode> {
  const code = normaliseCode(input.code);
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  if (input.rates.length === 0) throw new Error("A Tax Code needs a rate");
  try {
    const { rows } = await tx.query<{ id: string }>("insert into tax_codes (legal_entity_id, code, name) values ($1, $2, $3) returning id", [legalEntityId, code, name]);
    for (const r of input.rates) {
      await tx.query("insert into tax_code_rates (tax_code_id, valid_from, rate) values ($1, $2, $3)", [rows[0]!.id, checkDate(r.validFrom), checkRate(r.rate)]);
    }
    const found = await tx.query<Row>(`${SELECT} where t.id = $1`, [rows[0]!.id]);
    return toTaxCode(found.rows[0]!, serverToday());
  } catch (err) {
    if (uniqueViolation(err)) throw new Error(`Tax Code ${code} already exists at this Legal Entity`);
    throw err;
  }
}

export async function createTaxCode(
  pool: Pool,
  schema: string,
  legalEntityId: string,
  input: { code: string; name: string; rate: number; validFrom: string },
): Promise<TaxCode> {
  return withTenant(pool, schema, (tx) => insertTaxCode(tx, legalEntityId, { code: input.code, name: input.name, rates: [{ validFrom: input.validFrom, rate: input.rate }] }));
}

export async function renameTaxCode(pool: Pool, schema: string, legalEntityId: string, id: string, name: string): Promise<void> {
  const n = name.trim();
  if (!n) throw new Error("Name is required");
  await withTenant(pool, schema, async (tx) => {
    const { rowCount } = await tx.query("update tax_codes set name = $3 where id = $1 and legal_entity_id = $2", [id, legalEntityId, n]);
    if (!rowCount) throw new Error("Tax Code not found");
  });
}

/**
 * Add a rate from a date. Rates in force today or earlier are history and never
 * change (an invoice must re-render identically); only a future-dated rate can
 * be replaced. The first rate of a Tax Code may be back-dated freely.
 */
export async function addTaxRate(pool: Pool, schema: string, legalEntityId: string, taxCodeId: string, input: DatedRate, today = serverToday()): Promise<TaxCode> {
  return withTenant(pool, schema, async (tx) => {
    const owned = await tx.query("select 1 from tax_codes where id = $1 and legal_entity_id = $2", [taxCodeId, legalEntityId]);
    if (!owned.rowCount) throw new Error("Tax Code not found");
    const validFrom = checkDate(input.validFrom);
    const existing = await tx.query<{ valid_from: string }>("select to_char(valid_from, 'YYYY-MM-DD') as valid_from from tax_code_rates where tax_code_id = $1", [taxCodeId]);
    const dates = existing.rows.map((r) => r.valid_from);
    // A past or current date would rewrite history that charges may already carry.
    if (dates.length > 0 && validFrom <= today) throw new Error("Rates in force today or earlier cannot be changed; add a rate from a future date");
    await tx.query(
      `insert into tax_code_rates (tax_code_id, valid_from, rate) values ($1, $2, $3)
       on conflict (tax_code_id, valid_from) do update set rate = excluded.rate`,
      [taxCodeId, validFrom, checkRate(input.rate)],
    );
    const found = await tx.query<Row>(`${SELECT} where t.id = $1`, [taxCodeId]);
    return toTaxCode(found.rows[0]!, today);
  });
}

/** Only a future-dated rate can be removed; history stays. */
export async function removeTaxRate(pool: Pool, schema: string, legalEntityId: string, taxCodeId: string, validFrom: string, today = serverToday()): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const date = checkDate(validFrom);
    if (date <= today) throw new Error("Rates in force today or earlier cannot be removed");
    const count = await tx.query<{ n: number }>("select count(*)::int as n from tax_code_rates where tax_code_id = $1", [taxCodeId]);
    if ((count.rows[0]?.n ?? 0) <= 1) throw new Error("A Tax Code needs at least one rate");
    const { rowCount } = await tx.query(
      "delete from tax_code_rates r using tax_codes t where r.tax_code_id = t.id and t.id = $1 and t.legal_entity_id = $2 and r.valid_from = $3",
      [taxCodeId, legalEntityId, date],
    );
    if (!rowCount) throw new Error("Rate not found");
  });
}

/** The rate in force on a date for a Tax Code. */
export async function taxRateFor(pool: Pool, schema: string, taxCodeId: string, date: string): Promise<number | null> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ rate: string }>(
      "select rate from tax_code_rates where tax_code_id = $1 and valid_from <= $2 order by valid_from desc limit 1",
      [taxCodeId, checkDate(date)],
    );
    return rows[0] ? Number(rows[0].rate) : null;
  });
}

/** Ship the country's preset codes that the Legal Entity does not have yet; returns what was created. */
export async function applyTaxPreset(pool: Pool, schema: string, legalEntityId: string, country: string): Promise<TaxCode[]> {
  if (!isTaxPresetCountry(country)) throw new Error(`No Tax Code preset for ${country}`);
  return withTenant(pool, schema, async (tx) => {
    const existing = await tx.query<{ code: string }>("select code from tax_codes where legal_entity_id = $1", [legalEntityId]);
    const have = new Set(existing.rows.map((r) => r.code));
    const created: TaxCode[] = [];
    for (const preset of TAX_PRESETS[country]) {
      if (have.has(preset.code)) continue;
      created.push(await insertTaxCode(tx, legalEntityId, { code: preset.code, name: preset.name, rates: preset.rates ?? [{ validFrom: PRESET_RATE_START, rate: preset.rate }] }));
    }
    return created;
  });
}
