import PgBoss from "pg-boss";
import type { Pool } from "pg";
import { pruneNotifications, publishNotification } from "@hoteloftware/events";
import { runTenantJob, type TenantJobData, type TenantJobHandler } from "./jobs";
import { WEBHOOK_QUEUE, markWebhook, type WebhookJobData } from "./webhooks";

export const QUEUES = {
  webhook: WEBHOOK_QUEUE,
  /** Demo for ticket 13: a scheduled check per tenant that writes a notification. */
  tenantCheck: "tenant.check",
  /** Fans the tenant check out: one job per tenant. */
  tenantCheckAll: "tenant.check.all",
  /** Daily housekeeping of the control schema. */
  maintenance: "control.maintenance",
} as const;

/**
 * pg-boss on its own schema beside the tenant schemas (research: one shared
 * queue schema; jobs carry tenant id and identifiers only).
 */
export interface QueueOptions {
  tenantCheckCron?: string | null;
  /** Webhook processors by source name; later tickets register theirs. */
  processors?: Record<string, TenantJobHandler<WebhookJobData>>;
}

export async function startQueue(pool: Pool, connectionString: string, options: QueueOptions = {}): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString, schema: "pgboss", max: 4 });
  boss.on("error", (err) => console.error("[queue]", err));
  await boss.start();
  for (const name of Object.values(QUEUES)) await boss.createQueue(name);

  await boss.work<WebhookJobData>(QUEUES.webhook, { includeMetadata: true }, async (jobs) => {
    for (const job of jobs) {
      try {
        const processor = options.processors?.[job.data.source];
        await runTenantJob(pool, job.data, async (ctx) => {
          if (processor) await processor(ctx);
          else console.log(`[webhook] ${job.data.source} ${job.data.externalId} for ${ctx.tenant.slug}: no processor registered yet`);
        });
        await markWebhook(pool, job.data.eventId, { ok: true });
      } catch (err) {
        // pg-boss retries; the stored event turns "failed" only once the last attempt is gone.
        if (job.retryCount >= job.retryLimit) {
          await markWebhook(pool, job.data.eventId, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
        throw err;
      }
    }
  });

  await boss.work<TenantJobData>(QUEUES.tenantCheck, async (jobs) => {
    for (const job of jobs) {
      await runTenantJob(pool, job.data, async ({ tx, tenant }) => {
        const { rows } = await tx.query<{ n: number }>("select count(*)::int as n from properties");
        await publishNotification(tx, {
          tenantId: tenant.id,
          userId: null,
          kind: "tenant.check",
          title: `Worker check for ${tenant.name}`,
          body: `${rows[0]?.n ?? 0} properties set up. Jobs, schedules and live updates are running.`,
        });
      });
    }
  });

  await boss.work(QUEUES.tenantCheckAll, async () => {
    const { rows } = await pool.query<{ id: string }>("select id from control.tenants order by slug");
    for (const t of rows) await boss.send(QUEUES.tenantCheck, { tenantId: t.id } satisfies TenantJobData, { singletonKey: `tenant.check:${t.id}`, singletonSeconds: 30 });
  });

  await boss.work(QUEUES.maintenance, async () => {
    const pruned = await pruneNotifications(pool, 30);
    if (pruned) console.log(`[maintenance] pruned ${pruned} old notifications`);
  });
  await boss.schedule(QUEUES.maintenance, "15 3 * * *", {}, { tz: "Europe/Berlin" });

  if (options.tenantCheckCron) {
    await boss.schedule(QUEUES.tenantCheckAll, options.tenantCheckCron, {}, { tz: "Europe/Berlin" });
  } else {
    await boss.unschedule(QUEUES.tenantCheckAll).catch(() => undefined);
  }
  return boss;
}

/** Queue health for /health: the queue tables answer and the webhook queue exists. */
export async function queueHealthy(boss: PgBoss): Promise<boolean> {
  try {
    return (await boss.getQueue(QUEUES.webhook)) !== null;
  } catch {
    return false;
  }
}
