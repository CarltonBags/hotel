import PgBoss from "pg-boss";
import { todayIn } from "@hoteloftware/domain";
import pg, { type Pool } from "pg";
import { notifyGroupDuties, pruneNotifications, publishNotification } from "@hoteloftware/events";
import { runTenantJob, type TenantJobData, type TenantJobHandler } from "./jobs";
import type { PaymentProvider } from "@hoteloftware/payments";
import { remindGroupDeposits, runGroupDuties, connectedProperties, enqueueFullPushes, pruneChannelOutbox, claimDueReminders, deleteEndedTenants, deleteExpiredConversations, deleteOldUnassignedWhatsApp, deleteExpiredFiles, deleteFilesOfDeletedTenants, releaseReminder, deleteExpiredDemoTenants, deleteExpiredRegistrations, findTenantById, issueSubscriptionInvoices, listTenantUsers, queueMail } from "@hoteloftware/db";
import { checkHolds, type ProviderProcessor } from "./payments";
import { alertOverdueAudits } from "./night-audit";
import { sendScheduledReports } from "./reports";
import { alertMajorIncidents } from "./outage-alert";
import { prunePersonalEvents, WEBHOOK_QUEUE, markWebhook, type WebhookJobData } from "./webhooks";
import { runMessaging } from "./messaging";
import type { MailProvider, SmsProvider, WhatsAppProvider } from "@hoteloftware/messaging";
import { fileStore } from "@hoteloftware/storage";
import type { ChannelManager } from "@hoteloftware/channels";
import { pullChannelBookings, pushTenantChannels } from "./channels";
import { archiveFiscal, runFiscal } from "./fiscal";
import { syncLockKeys, type FiscalDeps, type LockDeps } from "@hoteloftware/db";

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
  /** Every minute: changes to rates and availability pushed to the channel manager, one job per tenant (ticket 37). */
  channelsAll: "channels.push.all",
  channels: "channels.push",
  /** Nightly: everything pushed once more over the whole horizon. */
  channelsFull: "channels.full",
  /** Every five minutes: channel bookings pulled even if a webhook was lost (ticket 38). */
  channelBookingsAll: "channels.bookings.all",
  channelBookings: "channels.bookings",
  /** Every minute: Receipts signed, days closed for DSFinV-K, one job per tenant (ticket 51). */
  fiscalAll: "fiscal.all",
  fiscal: "fiscal",
  /** Hourly: Held Rooms released on their date, warnings 3 days ahead, Tentative groups lapsed, deposits reminded (ticket 59), one job per tenant (ticket 58). */
  groupsAll: "groups.duties.all",
  groups: "groups.duties",
  /** At night: the months' signed data and DSFinV-K exports archived outside the provider. */
  fiscalArchiveAll: "fiscal.archive.all",
  fiscalArchive: "fiscal.archive",
  /** Every minute: door keys brought in line with check-ins, extensions, room moves and check-outs, one job per tenant (ticket 67). */
  locksAll: "locks.sync.all",
  locks: "locks.sync",
} as const;

/**
 * pg-boss on its own schema beside the tenant schemas (research: one shared
 * queue schema; jobs carry tenant id and identifiers only).
 */
export interface QueueOptions {
  tenantCheckCron?: string | null;
  /** The fiscal provider and the platform's fiscal secret (ticket 51). */
  fiscal?: FiscalDeps;
  /** Webhook processors by source name; later tickets register theirs. */
  processors?: Record<string, TenantJobHandler<WebhookJobData>>;
  /** Processors that call a provider: run without an open tenant transaction. */
  providerProcessors?: Record<string, ProviderProcessor>;
  /** The payment provider, for the Card Hold check. */
  paymentProvider?: PaymentProvider;
  /** Mail and SMS providers, and the platform's sending domain, for messages and alerts. */
  messaging?: { mail: MailProvider; sms: SmsProvider; whatsapp?: WhatsAppProvider; platformDomain: string };
  /** The secret door-lock credentials and PINs are sealed with (ticket 67). */
  locks?: LockDeps;
  /** The channel manager (Channex or the fake). */
  channelManager?: ChannelManager;
  /** Where the channel manager announces booking revisions (registered for each connected property). */
  channelWebhook?: { url: string; secret: string } | undefined;
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
    // guests' messages in stored webhook events (email replies, WhatsApp) go after a week, whatever became of the event
    await prunePersonalEvents(pool, ["mail-inbound", "whatsapp"]).catch((err) => console.error("[maintenance] personal webhook events", err));
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
    // deleted tenants' files leave the bucket (ticket 36)
    const emptied = await deleteFilesOfDeletedTenants(pool, fileStore()).catch((err) => (console.error("[maintenance] files of deleted tenants", err), [] as string[]));
    if (emptied.length) console.log(`[maintenance] removed the files of deleted tenants ${emptied.join(", ")}`);
    // Meldeschein records go on schedule: Germany from day 365 after departure, Austria after 7 years (ticket 45)
    const { rows: all } = await pool.query<{ slug: string; schema_name: string }>("select slug, schema_name from control.tenants");
    for (const t of all) {
      const n = await deleteExpiredRegistrations(pool, t.schema_name, today).catch((err) => (console.error(`[maintenance] registrations of ${t.slug}`, err), 0));
      if (n) console.log(`[maintenance] ${t.slug}: deleted ${n} registration record(s)`);
      await pruneChannelOutbox(pool, t.schema_name).catch((err) => console.error(`[maintenance] channel outbox of ${t.slug}`, err));
      // Conversations past their months after the stay, unless kept for a dispute (ticket 43); their files go just below
      const conv = await deleteExpiredConversations(pool, t.schema_name, today).catch((err) => (console.error(`[maintenance] conversations of ${t.slug}`, err), 0));
      if (conv) console.log(`[maintenance] ${t.slug}: deleted ${conv} conversation(s) past retention`);
      // WhatsApp messages nobody linked go after a month (ticket 44)
      await deleteOldUnassignedWhatsApp(pool, t.schema_name).catch((err) => console.error(`[maintenance] unassigned WhatsApp of ${t.slug}`, err));
      // stored files past their retention day (ticket 36)
      const f = await deleteExpiredFiles(pool, t.schema_name, fileStore(), today).catch((err) => (console.error(`[maintenance] files of ${t.slug}`, err), 0));
      if (f) console.log(`[maintenance] ${t.slug}: deleted ${f} file(s) past retention`);
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

  const manager = options.channelManager;
  if (manager) {
    await boss.work<TenantJobData>(QUEUES.channels, async (jobs) => {
      for (const job of jobs) {
        const tenant = await findTenantById(pool, job.data.tenantId);
        if (!tenant) continue;
        const r = await pushTenantChannels(pool, tenant, manager);
        if (r.sent || r.failed) console.log(`[channels] ${tenant.slug}: sent ${r.sent} change(s), ${r.failed} propert(y/ies) failing`);
      }
    });
    await boss.work(QUEUES.channelsAll, async () => {
      // only tenants with a connected property
      const { rows } = await pool.query<{ id: string; schema_name: string }>("select id, schema_name from control.tenants order by slug");
      for (const t of rows) {
        const connected = await connectedProperties(pool, t.schema_name).catch((err) => (console.error(`[channels] ${t.id}`, err), [] as string[]));
        if (connected.length) await boss.send(QUEUES.channels, { tenantId: t.id } satisfies TenantJobData, { singletonKey: `channels.push:${t.id}`, singletonSeconds: 50 });
      }
    });
    await boss.schedule(QUEUES.channelsAll, "* * * * *", {}, { tz: "Europe/Berlin" });
    await boss.work(QUEUES.channelsFull, async () => {
      const { rows } = await pool.query<{ slug: string; schema_name: string }>("select slug, schema_name from control.tenants");
      for (const t of rows) {
        const n = await enqueueFullPushes(pool, t.schema_name).catch((err) => (console.error(`[channels] full push of ${t.slug}`, err), 0));
        if (n) console.log(`[channels] ${t.slug}: full push queued for ${n} propert(y/ies)`);
      }
    });
    await boss.schedule(QUEUES.channelsFull, "30 2 * * *", {}, { tz: "Europe/Berlin" });
    await boss.work<TenantJobData>(QUEUES.channelBookings, async (jobs) => {
      for (const job of jobs) {
        const tenant = await findTenantById(pool, job.data.tenantId);
        if (!tenant) continue;
        const r = await pullChannelBookings(pool, tenant, manager, undefined, options.channelWebhook);
        if (r.applied || r.problems) console.log(`[channels] ${tenant.slug}: ${r.applied} booking revision(s) applied, ${r.problems} for staff`);
      }
    });
    await boss.work(QUEUES.channelBookingsAll, async () => {
      const { rows } = await pool.query<{ id: string; schema_name: string }>("select id, schema_name from control.tenants order by slug");
      for (const t of rows) {
        const connected = await connectedProperties(pool, t.schema_name).catch((err) => (console.error(`[channels] ${t.id}`, err), [] as string[]));
        if (connected.length) await boss.send(QUEUES.channelBookings, { tenantId: t.id } satisfies TenantJobData, { singletonKey: `channels.bookings:${t.id}`, singletonSeconds: 240 });
      }
    });
    await boss.schedule(QUEUES.channelBookingsAll, "*/5 * * * *", {}, { tz: "Europe/Berlin" });
  }

  const fiscal = options.fiscal;
  if (fiscal) {
    await boss.work<TenantJobData>(QUEUES.fiscal, async (jobs) => {
      for (const job of jobs) {
        const tenant = await findTenantById(pool, job.data.tenantId);
        if (!tenant) continue;
        const r = await runFiscal(pool, tenant, fiscal);
        if (r.signed || r.failed || r.closed) console.log(`[fiscal] ${tenant.slug}: signed ${r.signed}, unsigned ${r.failed}, closed ${r.closed}`);
      }
    });
    await boss.work(QUEUES.fiscalAll, async () => {
      const { rows } = await pool.query<{ id: string }>("select id from control.tenants order by slug");
      for (const t of rows) await boss.send(QUEUES.fiscal, { tenantId: t.id } satisfies TenantJobData, { singletonKey: `fiscal:${t.id}`, singletonSeconds: 50 });
    });
    await boss.schedule(QUEUES.fiscalAll, "* * * * *", {}, { tz: "Europe/Berlin" });
    await boss.work<TenantJobData>(QUEUES.fiscalArchive, async (jobs) => {
      for (const job of jobs) {
        const tenant = await findTenantById(pool, job.data.tenantId);
        if (!tenant) continue;
        const n = await archiveFiscal(pool, tenant, { ...fiscal, store: fileStore() });
        if (n) console.log(`[fiscal] ${tenant.slug}: ${n} archive(s) kept`);
      }
    });
    await boss.work(QUEUES.fiscalArchiveAll, async () => {
      const { rows } = await pool.query<{ id: string }>("select id from control.tenants order by slug");
      for (const t of rows) await boss.send(QUEUES.fiscalArchive, { tenantId: t.id } satisfies TenantJobData, { singletonKey: `fiscal.archive:${t.id}`, singletonSeconds: 1100 });
    });
    // every 20 minutes from 02:00 to 04:40: a provider export still being prepared is asked again
    await boss.schedule(QUEUES.fiscalArchiveAll, "*/20 2-4 * * *", {}, { tz: "Europe/Berlin" });
  }

  const locks = options.locks;
  if (locks) {
    await boss.work<TenantJobData>(QUEUES.locks, async (jobs) => {
      for (const job of jobs) {
        const tenant = await findTenantById(pool, job.data.tenantId);
        if (!tenant) continue;
        const r = await syncLockKeys(pool, tenant.schemaName, locks);
        if (r.done || r.failed) console.log(`[locks] ${tenant.slug}: ${r.done} stay(s) in line, ${r.failed} to try again`);
      }
    });
    await boss.work(QUEUES.locksAll, async () => {
      const { rows } = await pool.query<{ id: string }>("select id from control.tenants order by slug");
      for (const t of rows) await boss.send(QUEUES.locks, { tenantId: t.id } satisfies TenantJobData, { singletonKey: `locks:${t.id}`, singletonSeconds: 50 });
    });
    await boss.schedule(QUEUES.locksAll, "* * * * *", {}, { tz: "Europe/Berlin" });
    // a stay queued (a check-out, a lost key): its tenant's run starts at once, not at the next minute
    const listen = new pg.Client({ connectionString });
    listen.on("error", (err) => console.error("[locks] listener", err));
    await listen.connect();
    await listen.query("listen hs_lock_sync");
    listen.on("notification", (n) => {
      void pool
        .query<{ id: string }>("select id from control.tenants where schema_name = $1", [n.payload ?? ""])
        .then(({ rows }) => (rows[0] ? boss.send(QUEUES.locks, { tenantId: rows[0].id } satisfies TenantJobData, { singletonKey: `locks:${rows[0].id}`, singletonSeconds: 5 }) : null))
        .catch((err: unknown) => console.error("[locks] notify", err));
    });
  }

  await boss.work<TenantJobData>(QUEUES.groups, async (jobs) => {
    for (const job of jobs) {
      const tenant = await findTenantById(pool, job.data.tenantId);
      if (!tenant) continue;
      // the release has committed: a failing deposit look must not swallow its notices
      const depositsDue = await remindGroupDeposits(pool, tenant.schemaName).catch((err) => (console.error("[groups] deposits", err), []));
      const d = { ...(await runGroupDuties(pool, tenant.schemaName)), depositsDue };
      await notifyGroupDuties(pool, tenant, d).catch((err) => console.error("[groups] not told", err));
      if (d.released.length || d.lapsed.length) console.log(`[groups] ${tenant.slug}: released ${d.released.length}, lapsed ${d.lapsed.length}`);
    }
  });
  await boss.work(QUEUES.groupsAll, async () => {
    const { rows } = await pool.query<{ id: string }>("select id from control.tenants order by slug");
    for (const t of rows) await boss.send(QUEUES.groups, { tenantId: t.id } satisfies TenantJobData, { singletonKey: `groups:${t.id}`, singletonSeconds: 300 });
  });
  // hourly: a Business Date moves on with each property's Night Audit
  await boss.schedule(QUEUES.groupsAll, "20 * * * *", {}, { tz: "Europe/Berlin" });

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
