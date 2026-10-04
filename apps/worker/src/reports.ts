import type { Pool } from "pg";
import { REPORT_ACCESS, addDays, can, scheduledRange, type Grain, type ScheduleFrequency } from "@hoteloftware/domain";
import { dueReportSchedules, listTenantUsers, logReportExport, markReportScheduleSent, queueMail, runReport, stopReportSchedule } from "@hoteloftware/db";
import { renderReportPdf } from "@hoteloftware/invoices";

const DEFAULT_GRAIN: Record<ScheduleFrequency, Grain> = { daily: "day", weekly: "day", monthly: "week" };

/**
 * Scheduled reports (ticket 82): each due schedule is run for the period
 * that just ended and its PDF queued to the scheduling user's own address,
 * as long as that user still may see the report at every property in it;
 * otherwise the schedule stops, with the reason shown to its user.
 */
export async function sendScheduledReports(pool: Pool, tenant: { id: string; name: string; schemaName: string }, now = new Date()): Promise<number> {
  const due = await dueReportSchedules(pool, tenant.schemaName, now);
  if (!due.length) return 0;
  const users = await listTenantUsers(pool, tenant.id);
  let sent = 0;
  for (const s of due) {
    const u = users.find((x) => x.id === s.userId && !x.pendingInvitation);
    const actor = u ? { tenantRole: u.tenantRole, propertyRoles: u.propertyRoles } : null;
    if (!actor || !s.propertyIds.every((p) => can(actor, REPORT_ACCESS[s.kind], p))) {
      await stopReportSchedule(pool, tenant.schemaName, s.id, "The user may no longer see this report at every property in it");
      continue;
    }
    // marked first: a crash part-way sends nothing twice on a day
    await markReportScheduleSent(pool, tenant.schemaName, s.id, s.localDate);
    // pickup looks ahead: the next 90 nights, gained since the period began
    const past = scheduledRange(s.frequency, s.localDate);
    const range = s.kind === "pickup" ? { from: s.localDate, to: addDays(s.localDate, 89) } : past;
    try {
      const table = await runReport(pool, tenant.schemaName, {
        kind: s.kind,
        ...range,
        propertyIds: s.propertyIds,
        grain: s.options.grain ?? DEFAULT_GRAIN[s.frequency],
        compare: s.options.compare ?? { previous: false, lastYear: true },
        roomTypeId: s.options.roomTypeId ?? null,
        ...(s.options.currency ? { currency: s.options.currency } : {}),
        ...(s.options.rates ? { rates: s.options.rates } : {}),
        ...(s.kind === "pickup" ? { pickupSince: past.from } : {}),
        language: s.language,
      });
      const pdf = await renderReportPdf(table, s.language, `Hoteloftware · ${tenant.name} · ${s.localDate}`);
      await queueMail(pool, tenant.schemaName, {
        tenantId: tenant.id,
        toUserId: s.userId,
        subject: `${table.title} · ${range.from} – ${range.to}`,
        body: `${table.title}\n${table.notes.join("\n")}\n\n${s.language === "de" ? "Der Bericht liegt als PDF bei." : "The report is attached as PDF."}`,
        attachment: { name: `${s.kind}-${range.from}-${range.to}.pdf`, type: "application/pdf", bytes: pdf },
      });
      await logReportExport(pool, tenant.schemaName, { userId: s.userId, kind: s.kind, propertyIds: s.propertyIds, format: "mail", rowCount: table.rows.length });
      sent++;
    } catch (err) {
      // a report that cannot run (a rate no longer stated, a property gone) stops instead of failing every hour
      await stopReportSchedule(pool, tenant.schemaName, s.id, err instanceof Error ? err.message : String(err));
    }
  }
  return sent;
}
