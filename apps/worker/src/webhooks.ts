import { timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";

/** A database handle pg-boss can enqueue through, so the job joins the caller's transaction. */
export interface QueueDb {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** The minimum of a queue the intake needs; pg-boss satisfies it. */
export interface QueueLike {
  send(name: string, data: object, options?: { singletonKey?: string; db?: QueueDb }): Promise<string | null>;
  healthy?(): Promise<boolean>;
}

export const WEBHOOK_QUEUE = "webhook.process";

/**
 * One inbound source (channel manager, payment provider, email provider, ...).
 * Later tickets add their sources; the intake stays the same.
 */
export interface WebhookSource {
  name: string;
  /** The provider's own event id; null when the event cannot be identified. */
  externalId: (headers: Record<string, string>, body: unknown) => string | null;
  /** The provider's id for the hotel (property, account) used to find the tenant in control.external_ids. */
  externalRef: (body: unknown, headers: Record<string, string>) => string | null;
  /** Signature or secret check. Nothing is stored when it fails. */
  verify: (headers: Record<string, string>, rawBody: string) => boolean;
}

export interface IntakeResult {
  status: 200 | 202 | 400 | 401;
  duplicate: boolean;
}

export interface WebhookJobData {
  eventId: string;
  source: string;
  externalId: string;
  tenantId: string;
}

/**
 * Store the raw event and acknowledge; processing is a job keyed by
 * (source, external id), so a replayed event is accepted and never
 * processed twice. Events whose tenant is unknown are kept as "ignored".
 */
export async function receiveWebhook(
  pool: Pool,
  queue: QueueLike,
  source: WebhookSource,
  input: { headers: Record<string, string>; rawBody: string },
): Promise<IntakeResult> {
  if (!source.verify(input.headers, input.rawBody)) return { status: 401, duplicate: false };
  let body: unknown = null;
  try {
    body = input.rawBody ? JSON.parse(input.rawBody) : null;
  } catch {
    body = null;
  }
  const externalId = source.externalId(input.headers, body);
  if (!externalId) return { status: 400, duplicate: false };

  const ref = source.externalRef(body, input.headers);
  const mapping = ref
    ? await pool.query<{ tenant_id: string }>("select tenant_id from control.external_ids where provider = $1 and external_id = $2", [source.name, ref])
    : null;
  const tenantId = mapping?.rows[0]?.tenant_id ?? null;

  // The stored event and its job commit together: an event is never left "received" without a job.
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ id: string }>(
      `insert into control.webhook_events (source, external_id, tenant_id, headers, body, raw_body, status)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (source, external_id) do nothing
       returning id`,
      [source.name, externalId, tenantId, JSON.stringify(redact(input.headers)), body === null ? null : JSON.stringify(body), input.rawBody, tenantId ? "received" : "ignored"],
    );
    if (!rows[0]) {
      await client.query("rollback");
      return { status: 200, duplicate: true };
    }
    if (tenantId) {
      const job: WebhookJobData = { eventId: rows[0].id, source: source.name, externalId, tenantId };
      await queue.send(WEBHOOK_QUEUE, job, {
        singletonKey: `${source.name}:${externalId}`,
        db: { executeSql: (text, values) => client.query(text, values as unknown[] | undefined) },
      });
    }
    await client.query("commit");
    return { status: 202, duplicate: false };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Secrets never land in the stored headers. */
function redact(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = /secret|signature|authorization|token|cookie/i.test(k) ? "[redacted]" : v;
  }
  return out;
}

/** Mark a stored event processed or failed after its job ran. */
export async function markWebhook(pool: Pool, eventId: string, outcome: { ok: true } | { ok: false; error: string }): Promise<void> {
  await pool.query("update control.webhook_events set status = $2, processed_at = now(), error = $3 where id = $1", [
    eventId,
    outcome.ok ? "processed" : "failed",
    outcome.ok ? null : outcome.error.slice(0, 2000),
  ]);
}

/** A source for tests and the deploy check: a shared secret header, ids in the body. */
export function testSource(secret: string): WebhookSource {
  return {
    name: "test",
    externalId: (headers, body) => (body as { id?: string } | null)?.id ?? headers["x-event-id"] ?? null,
    externalRef: (body) => (body as { property?: string } | null)?.property ?? null,
    verify: (headers) => {
      const given = Buffer.from(headers["x-webhook-secret"] ?? "");
      const expected = Buffer.from(secret);
      return secret.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
    },
  };
}
