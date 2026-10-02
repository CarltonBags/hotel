import type { Pool } from "pg";

/**
 * Map a provider's id for a hotel (a payment provider's connected account, a
 * channel manager's property) to its tenant, so the webhook intake can route
 * the provider's events (control.external_ids, ticket 13).
 */
export async function mapProviderAccount(pool: Pool, provider: string, externalId: string, tenantId: string, propertyId: string | null = null): Promise<void> {
  await pool.query("insert into control.external_ids (provider, external_id, tenant_id, property_id) values ($1, $2, $3, $4) on conflict do nothing", [provider, externalId, tenantId, propertyId]);
}
