import type { PoolClient } from "pg";

/**
 * Serialises writes that must see each other at one property: rates and
 * restrictions, plan edits, and reservations against availability. Every
 * writer of these takes it first in its transaction.
 */
export async function lockProperty(tx: PoolClient, propertyId: string): Promise<void> {
  await tx.query("select 1 from properties where id = $1 for update", [propertyId]);
}
