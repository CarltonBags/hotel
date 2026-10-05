import type { PoolClient } from "pg";

export interface SenderOptions {
  /** The platform's sending domain, used until a hotel's own domain is verified. */
  platformDomain: string;
}

export interface Sender {
  from: string;
  fromName: string;
  replyTo: string | undefined;
  /** Set when the hotel's own domain is verified: mail goes through it, so its signature matches the sender. */
  sendingDomain: string | undefined;
}

/** How a property's mail goes out: from its verified domain, else from the platform domain under the hotel's name. */
export async function senderFor(tx: PoolClient, propertyId: string, options: SenderOptions): Promise<Sender> {
  await tx.query("insert into property_messaging (property_id, started_at) select id, created_at from properties where id = $1 on conflict do nothing", [propertyId]);
  const { rows } = await tx.query<{ name: string; sender_domain: string | null; sender_local: string; sender_verified: boolean; reply_to: string | null }>(
    `select p.name, pm.sender_domain, pm.sender_local, pm.sender_verified, coalesce(pm.reply_to, nullif(le.invoice_email, '')) as reply_to
     from properties p join legal_entities le on le.id = p.legal_entity_id join property_messaging pm on pm.property_id = p.id where p.id = $1`,
    [propertyId],
  );
  const r = rows[0];
  if (!r) throw new Error("No such property");
  const own = r.sender_verified && r.sender_domain ? r.sender_domain : null;
  return { from: own ? `${r.sender_local}@${own}` : `no-reply@${options.platformDomain}`, fromName: r.name, replyTo: r.reply_to ?? undefined, sendingDomain: own ?? undefined };
}
