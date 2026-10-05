import PgBoss from "pg-boss";
import { todayIn } from "@hoteloftware/domain";
import type { Pool } from "pg";
import { pruneNotifications, publishNotification } from "@hoteloftware/events";
import { runTenantJob, type TenantJobData, type TenantJobHandler } from "./jobs";
import type { PaymentProvider } from "@hoteloftware/payments";
import { claimDueReminders, deleteEndedTenants, releaseReminder, deleteExpiredDemoTenants, deleteExpiredRegistrations, findTenantById, issueSubscriptionInvoices, listTenantUsers, queueMail } from "@hoteloftware/db";
import { checkHolds, type ProviderProcessor } from "./payments";
import { alertOverdueAudits } from "./night-audit";
import { sendScheduledReports } from "./reports";
import { alertMajorIncidents } from "./outage-alert";
import { WEBHOOK_QUEUE, markWebhook, type WebhookJobData } from "./webhooks";
import { runMessaging } from "./messaging";
import type { MailProvider, SmsProvider } from "@hoteloftware/messaging";

export const QUEUES = {
  webhook: WEBHOOK_QUEUE,
  /** Demo for ticket 13: a scheduled check per tenant that writes a notification. */
  tenantCheck: "tenant.check",
  /** Fans the tenant check out: one job per tenant. */
  tenantCheckAll: "tenant.check.all",
  /** Daily housekeeping of the control schema. */
  maintenance: "control.maintenance",
  /** Hourly: renew Card Holds close to expiry, one job per tenant (ticket 27). */
  holdCheckAll: "payments.holds.all",
  holdCheck: "payments.holds",
  /** Every 15 minutes: alert Night Audits past their deadline, one job per tenant (ticket 32). */
  auditCheckAll: "night_audit.overdue.all",
  auditCheck: "night_audit.overdue",
  /** Hourly: scheduled reports due, one job per tenant (ticket 82). */
  reportsAll: "reports.scheduled.all",
  reports: "reports.scheduled",
  /** On the 1st: each live tenant's subscription invoices (ticket 88). */
  subscriptionBilling: "subscription.billing",
  /** Every minute: a major incident on our side alerts the customers' Property Managers (ticket 86). */
  outageAlerts: "status.outage_alerts",
  /** Every minute: guest messages derived and sent, staff mail and SMS sent, one job per tenant (ticket 39). */
  messagingAll: "messaging.all",
  messaging: "messaging",
} as const;

/**
 * pg-boss on its own schema beside the tenant schemas (research: one shared
 * queue schema; jobs carry tenant id and identifiers only).
 */
export interface QueueOptions {
  tenantCheckCron?: string | null;
  /** Webhook processors by source name; later tickets register theirs. */
  processors?: Record<string, TenantJobHandler<WebhookJobData>>;
  /** Processors that call a provider: run without an open tenant transaction. */
  providerProcessors?: Record<string, ProviderProcessor>;
  /** The payment provider, for the Card Hold check. */
  paymentProvider?: PaymentProvider;
  /** Mail and SMS providers, and the platform's sending domain, for messages and alerts. */
  messaging?: { mail: MailProvider; sms: SmsProvider; platformDomain: string };
}

export async function startQueue(pool: Pool, connectionString: string, options: QueueOptions = {}): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString, schema: "pgboss", max: 4 });
  boss.on("error", (err) => console.error("[queue]", err));
  await boss.start();
  for (const name of Object.values(QUEUES)) await boss.createQueue(name);

  await boss.work<WebhookJobData>(QUEUES.webhook, { includeMetadata: true }, async (jobs) => {
    for (const job of jobs) {
      try {
        const providerProcessor = options.providerProcessors?.[job.data.source];
        if (providerProcessor) {
          const tenant = await findTenantById(pool, job.data.tenantId);
          if (!tenant) throw new Error(`Unknown tenant ${job.data.tenantId}`);
          await providerProcessor({ tenant, data: job.data, pool });
        } else {
          const processor = options.processors?.[job.data.source];
          await runTenantJob(pool, job.data, async (ctx) => {
            if (processor) await processor(ctx);
            else console.log(`[webhook] ${job.data.source} ${job.data.externalId} for ${ctx.tenant.slug}: no processor registered yet`);
          });
        }
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
    // a demo trial is deleted 30 days after it ended (ticket 87)
    const demos = await deleteExpiredDemoTenants(pool);
    if (demos.length) console.log(`[maintenance] deleted demo tenants ${demos.join(", ")}`);
    // the subscription overdue: the Owner is reminded on days 1, 10, 20 and 30 (ticket 89); ended tenants go after 90 days
    // the platform's day, as the app reckons the stage
    const today = todayIn("Europe/Berlin");
    for (const r of await claimDueReminders(pool, today)) {
      const owners = (await listTenantUsers(pool, r.tenantId)).filter((u) => u.tenantRole === "owner");
      const tenant = await findTenantById(pool, r.tenantId);
      try {
        for (const o of owners) {
          await publishNotification(pool, { tenantId: r.tenantId, userId: o.id, kind: "subscription.overdue", title: `Subscription invoice ${r.number} is ${r.day} days overdue`, href: "/settings/subscription" });
          if (tenant) await queueMail(pool, tenant.schemaName, { tenantId: r.tenantId, toUserId: o.id, subject: `Reminder: invoice ${r.number} is overdue`, body: `Invoice ${r.number} was due on ${r.dueDate} and is ${r.day} days overdue. From day 30 settings and reports are locked; from day 60 no new online reservations; from day 90 the contract may be terminated.` });
        }
      } catch (err) {
        // not sent: released, the next run tries again
        await releaseReminder(pool, r.number, r.day);
        console.error(`[reminders] ${r.number}`, err);
      }
    }
    const gone = await deleteEndedTenants(pool, today);
    if (gone.length) console.log(`[maintenance] deleted ended tenants ${gone.join(", ")}`);
    // Meldeschein records go on schedule: Germany from day 365 after departure, Austria after 7 years (ticket 45)
    const { rows: all } = await pool.query<{ slug: string; schema_name: string }>("select slug, schema_name from control.tenants");
    for (const t of all) {
      const n = await deleteExpiredRegistrations(pool, t.schema_name, today).catch((err) => (console.error(`[maintenance] registrations of ${t.slug}`, err), 0));
      if (n) console.log(`[maintenance] ${t.slug}: deleted ${n} registration record(s)`);
    }
  });
  await boss.schedule(QUEUES.maintenance, "15 3 * * *", {}, { tz: "Europe/Berlin" });

  const provider = options.paymentProvider;
  if (provider) {
    await boss.work<TenantJobData>(QUEUES.holdCheck, async (jobs) => {
      for (const job of jobs) {
        const tenant = await findTenantById(pool, job.data.tenantId);
        if (!tenant) continue;
        const r = await checkHolds(pool, tenant, provider);
        if (r.renewed || r.failed) console.log(`[holds] ${tenant.slug}: renewed ${r.renewed}, could not renew ${r.failed}`);
      }
    });
    await boss.work(QUEUES.holdCheckAll, async () => {
      const { rows } = await pool.query<{ id: string }>("select id from control.tenants order by slug");
      for (const t of rows) await boss.send(QUEUES.holdCheck, { tenantId: t.id } satisfies TenantJobData, { singletonKey: `payments.holds:${t.id}`, singletonSeconds: 300 });
    });
    await boss.schedule(QUEUES.holdCheckAll, "5 * * * *", {}, { tz: "Europe/Berlin" });
  }

  await boss.work<TenantJobData>(QUEUES.auditCheck, async (jobs) => {
    for (const job of jobs) {
      const tenant = await findTenantById(pool, job.data.tenantId);
      if (tenant) await alertOverdueAudits(pool, tenant);
    }
  });
  await boss.work(QUEUES.auditCheckAll, async () => {
    const { rows } = await pool.query<{ id: string }>("select id from control.tenants order by slug");
    for (const t of rows) await boss.send(QUEUES.auditCheck, { tenantId: t.id } satisfies TenantJobData, { singletonKey: `night_audit.overdue:${t.id}`, singletonSeconds: 300 });
  });
  await boss.schedule(QUEUES.auditCheckAll, "*/15 * * * *", {}, { tz: "Europe/Berlin" });

  await boss.work<TenantJobData>(QUEUES.reports, async (jobs) => {
    for (const job of jobs) {
      const tenant = await findTenantById(pool, job.data.tenantId);
      if (!tenant) continue;
      const n = await sendScheduledReports(pool, tenant);
      if (n) console.log(`[reports] ${tenant.slug}: ${n} scheduled report(s) queued`);
    }
  });
  await boss.work(QUEUES.reportsAll, async () => {
    const { rows } = await pool.query<{ id: string }>("select id from control.tenants order by slug");
    for (const t of rows) await boss.send(QUEUES.reports, { tenantId: t.id } satisfies TenantJobData, { singletonKey: `reports.scheduled:${t.id}`, singletonSeconds: 300 });
  });
  await boss.schedule(QUEUES.reportsAll, "5 * * * *", {}, { tz: "Europe/Berlin" });

  await boss.work(QUEUES.outageAlerts, async () => {
    const n = await alertMajorIncidents(pool, { platformSlug: process.env.PLATFORM_TENANT_SLUG ?? "platform", statusUrl: `${(process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "")}/status` });
    if (n) console.log(`[outage] ${n} Property Manager(s) alerted`);
  });
  await boss.schedule(QUEUES.outageAlerts, "* * * * *", {}, { tz: "Europe/Berlin" });

  const messaging = options.messaging;
  if (messaging) {
    await boss.work<TenantJobData>(QUEUES.messaging, async (jobs) => {
      for (const job of jobs) {
        const tenant = await findTenantById(pool, job.data.tenantId);
        if (!tenant) continue;
        const r = await runMessaging(pool, tenant, messaging, messaging.platformDomain);
        if (r.queued || r.sent || r.failed) console.log(`[messaging] ${tenant.slug}: queued ${r.queued}, sent ${r.sent}, failed ${r.failed}`);
      }
    });
    await boss.work(QUEUES.messagingAll, async () => {
      const { rows } = await pool.query<{ id: string }>("select id from control.tenants order by slug");
      for (const t of rows) await boss.send(QUEUES.messaging, { tenantId: t.id } satisfies TenantJobData, { singletonKey: `messaging:${t.id}`, singletonSeconds: 50 });
    });
    await boss.schedule(QUEUES.messagingAll, "* * * * *", {}, { tz: "Europe/Berlin" });
  }

  await boss.work(QUEUES.subscriptionBilling, async () => {
    // trials and Test Mode are not billed; a failing tenant does not stop the others
    const { rows } = await pool.query<{ id: string }>("select id from control.tenants where live_at is not null and slug <> $1", [process.env.PLATFORM_TENANT_SLUG ?? "platform"]);
    const month = `${todayIn("Europe/Berlin").slice(0, 7)}-01`;
    for (const t of rows) {
      const tenant = await findTenantById(pool, t.id);
      if (!tenant) continue;
      try {
        const issued = await issueSubscriptionInvoices(pool, tenant, month);
        if (issued.length) console.log(`[billing] ${tenant.slug}: ${issued.join(", ")}`);
      } catch (err) {
        console.error(`[billing] ${tenant.slug}`, err);
      }
    }
  });
  await boss.schedule(QUEUES.subscriptionBilling, "30 4 1 * *", {}, { tz: "Europe/Berlin" });

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
