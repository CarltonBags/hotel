import type { Pool } from "pg";

/**
 * Map a provider's id for a hotel (a payment provider's connected account, a
 * channel manager's property) to its tenant, so the webhook intake can route
 * the provider's events (control.external_ids, ticket 13).
 */
export async function mapProviderAccount(pool: Pool, provider: string, externalId: string, tenantId: string, propertyId: string | null = null): Promise<void> {
  await pool.query("insert into control.external_ids (provider, external_id, tenant_id, property_id) values ($1, $2, $3, $4) on conflict do nothing", [provider, externalId, tenantId, propertyId]);
}

/**
 * Claim a provider's id for a hotel that must own it alone (a WhatsApp number,
 * ticket 44): refused while another tenant holds it; moved when the same
 * tenant connects it at another property.
 */
export async function claimProviderAccount(pool: Pool, provider: string, externalId: string, tenantId: string, propertyId: string): Promise<void> {
  const { rows } = await pool.query<{ tenant_id: string }>(
    `insert into control.external_ids (provider, external_id, tenant_id, property_id) values ($1, $2, $3, $4)
     on conflict (provider, external_id) do update set property_id = excluded.property_id where control.external_ids.tenant_id = excluded.tenant_id
     returning tenant_id`,
    [provider, externalId, tenantId, propertyId],
  );
  if (!rows[0]) throw new Error("This WhatsApp account or number is connected to another customer");
}
