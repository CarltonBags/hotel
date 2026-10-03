import type { PoolClient } from "pg";

/** The rate of a Tax Code in force on a date. */
export async function rateOn(tx: PoolClient, taxCodeId: string, date: string): Promise<number> {
  const { rows } = await tx.query<{ rate: string }>("select rate from tax_code_rates where tax_code_id = $1 and valid_from <= $2 order by valid_from desc limit 1", [taxCodeId, date]);
  if (!rows[0]) throw new Error(`The Tax Code has no rate in force on ${date}`);
  return Number(rows[0].rate);
}
