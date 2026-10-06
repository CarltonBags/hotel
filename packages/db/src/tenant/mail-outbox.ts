import type { Pool } from "pg";
import { escapeHtml } from "@hoteloftware/domain";
import type { MailProvider, SmsProvider } from "@hoteloftware/messaging";
import { senderFor, type SenderOptions } from "./sender";
import { withTenant } from "./with-tenant";

export interface OutgoingMail {
  tenantId: string;
  /** Mail goes to a user's own address, read here from the account. */
  toUserId: string;
  subject: string;
  body: string;
  /** The body as HTML, when the mail has a layout of its own. */
  html?: string;
  /** Sent as this hotel (its sender and domain) rather than as the platform: a test send of a guest text. */
  propertyId?: string;
  attachment?: { name: string; type: string; bytes: Uint8Array };
}

/** Queue a mail to a user of the tenant (ticket 82); the dispatch job sends the outbox (ticket 39). */
export async function queueMail(pool: Pool, schema: string, mail: OutgoingMail): Promise<string> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into mail_outbox (to_user_id, to_email, subject, body, attachment_name, attachment_type, attachment, html, property_id)
       select u.id, u.email, $3, $4, $5, $6, $7, $8, $9 from control."user" u where u.id = $2 and u.tenant_id = $1 returning id`,
      [mail.tenantId, mail.toUserId, mail.subject, mail.body, mail.attachment?.name ?? null, mail.attachment?.type ?? null, mail.attachment ? Buffer.from(mail.attachment.bytes) : null, mail.html ?? null, mail.propertyId ?? null],
    );
    if (!rows[0]) throw new Error("No such user in this tenant");
    return rows[0].id;
  });
}

/** Queue an SMS to a user's phone (urgent Notifications). */
export async function queueSms(pool: Pool, schema: string, input: { toUserId: string; toPhone: string; body: string }): Promise<void> {
  await withTenant(pool, schema, (tx) => tx.query("insert into sms_outbox (to_user_id, to_phone, body) values ($1, $2, $3)", [input.toUserId, input.toPhone, input.body.slice(0, 480)]));
}

export const OUTBOX_MAX_ATTEMPTS = 5;
/** The SMS sender name (at most 11 characters). */
const SMS_SENDER = "Hoteloftwr";

/**
 * Staff mail (reports, reminders, Notifications) and SMS. A row is claimed
 * before sending and only one run sends it; a failure releases it for the
 * next run; a row whose run died stays claimed and is not sent twice.
 */
export async function dispatchOutboxes(pool: Pool, schema: string, tenantId: string, providers: { mail: MailProvider; sms: SmsProvider }, options: SenderOptions): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const mails = await withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query(
      `update mail_outbox o set attempts = attempts + 1, claimed_at = now()
       from (select id from mail_outbox where sent_at is null and claimed_at is null and attempts < $1 order by created_at limit 50 for update skip locked) d
       where o.id = d.id returning o.id, o.to_email, o.subject, o.body, o.html, o.property_id, o.attachment_name, o.attachment_type, o.attachment`,
      [OUTBOX_MAX_ATTEMPTS],
    );
    return rows as { id: string; to_email: string; subject: string; body: string; html: string | null; property_id: string | null; attachment_name: string | null; attachment_type: string | null; attachment: Buffer | null }[];
  });
  for (const m of mails) {
    try {
      const sender = m.property_id ? await withTenant(pool, schema, (tx) => senderFor(tx, m.property_id!, options)) : { from: `no-reply@${options.platformDomain}`, fromName: "Hoteloftware", replyTo: undefined, sendingDomain: undefined };
      await providers.mail.send({
        ...sender,
        to: m.to_email,
        subject: m.subject,
        html: m.html ?? `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;white-space:pre-wrap">${escapeHtml(m.body)}</body></html>`,
        text: m.body,
        attachments: m.attachment ? [{ name: m.attachment_name!, type: m.attachment_type ?? "application/octet-stream", bytes: new Uint8Array(m.attachment) }] : [],
        tags: { tenantId, messageId: `outbox:${m.id}` },
      });
    } catch (err) {
      await withTenant(pool, schema, (tx) => tx.query("update mail_outbox set claimed_at = null, error = $2 where id = $1", [m.id, err instanceof Error ? err.message.slice(0, 500) : String(err)]));
      failed++;
      continue;
    }
    await withTenant(pool, schema, (tx) => tx.query("update mail_outbox set sent_at = now(), error = null where id = $1", [m.id]));
    sent++;
  }
  const texts = await withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query(
      `update sms_outbox o set attempts = attempts + 1, claimed_at = now()
       from (select id from sms_outbox where sent_at is null and claimed_at is null and attempts < $1 order by created_at limit 50 for update skip locked) d
       where o.id = d.id returning o.id, o.to_phone, o.body`,
      [OUTBOX_MAX_ATTEMPTS],
    );
    return rows as { id: string; to_phone: string; body: string }[];
  });
  for (const t of texts) {
    let providerId: string;
    try {
      providerId = (await providers.sms.send({ to: t.to_phone, text: t.body, sender: SMS_SENDER })).providerId;
    } catch (err) {
      await withTenant(pool, schema, (tx) => tx.query("update sms_outbox set claimed_at = null, error = $2 where id = $1", [t.id, err instanceof Error ? err.message.slice(0, 500) : String(err)]));
      failed++;
      continue;
    }
    await withTenant(pool, schema, (tx) => tx.query("update sms_outbox set sent_at = now(), provider_id = $2, error = null where id = $1", [t.id, providerId]));
    sent++;
  }
  return { sent, failed };
}
