import type { Pool } from "pg";

export interface OutgoingMail {
  tenantId: string;
  /** Mail goes to a user's own address, read here from the account. */
  toUserId: string;
  subject: string;
  body: string;
  attachment?: { name: string; type: string; bytes: Uint8Array };
}

/** Queue a mail to a user (ticket 82); the mail provider sends the outbox (ticket 39). */
export async function queueMail(pool: Pool, mail: OutgoingMail): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into control.mail_outbox (tenant_id, to_user_id, to_email, subject, body, attachment_name, attachment_type, attachment)
     select $1, u.id, u.email, $3, $4, $5, $6, $7 from control."user" u where u.id = $2 and u.tenant_id = $1 returning id`,
    [mail.tenantId, mail.toUserId, mail.subject, mail.body, mail.attachment?.name ?? null, mail.attachment?.type ?? null, mail.attachment ? Buffer.from(mail.attachment.bytes) : null],
  );
  if (!rows[0]) throw new Error("No such user in this tenant");
  return rows[0].id;
}

export interface OutboxEntry {
  id: string;
  toUserId: string;
  toEmail: string;
  subject: string;
  attachmentName: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

export async function listOutbox(pool: Pool, tenantId: string, limit = 50): Promise<OutboxEntry[]> {
  const { rows } = await pool.query<{ id: string; to_user_id: string; to_email: string; subject: string; attachment_name: string | null; created_at: Date; sent_at: Date | null }>(
    "select id, to_user_id, to_email, subject, attachment_name, created_at, sent_at from control.mail_outbox where tenant_id = $1 order by created_at desc limit $2",
    [tenantId, limit],
  );
  return rows.map((r) => ({ id: r.id, toUserId: r.to_user_id, toEmail: r.to_email, subject: r.subject, attachmentName: r.attachment_name, createdAt: r.created_at, sentAt: r.sent_at }));
}
