import type { Pool } from "pg";
import { withTenant } from "./with-tenant";

export interface OutgoingMail {
  tenantId: string;
  /** Mail goes to a user's own address, read here from the account. */
  toUserId: string;
  subject: string;
  body: string;
  /** The body as HTML, when the mail has a layout of its own. */
  html?: string;
  attachment?: { name: string; type: string; bytes: Uint8Array };
}

/** Queue a mail to a user of the tenant (ticket 82); the mail provider sends the outbox (ticket 39). */
export async function queueMail(pool: Pool, schema: string, mail: OutgoingMail): Promise<string> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into mail_outbox (to_user_id, to_email, subject, body, attachment_name, attachment_type, attachment, html)
       select u.id, u.email, $3, $4, $5, $6, $7, $8 from control."user" u where u.id = $2 and u.tenant_id = $1 returning id`,
      [mail.tenantId, mail.toUserId, mail.subject, mail.body, mail.attachment?.name ?? null, mail.attachment?.type ?? null, mail.attachment ? Buffer.from(mail.attachment.bytes) : null, mail.html ?? null],
    );
    if (!rows[0]) throw new Error("No such user in this tenant");
    return rows[0].id;
  });
}
