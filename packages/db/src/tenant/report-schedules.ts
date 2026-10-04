import type { Pool } from "pg";
import { REPORT_KINDS, SCHEDULE_FREQUENCIES, scheduleDue, type Grain, type ReportKind, type ScheduleFrequency } from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { withTenant } from "./with-tenant";

/** What a scheduled report keeps besides its kind and properties. */
export interface ScheduleOptions {
  grain?: Grain;
  compare?: { previous: boolean; lastYear: boolean };
  roomTypeId?: string | null;
  currency?: string;
  rates?: Record<string, number>;
}

export interface ReportSchedule {
  id: string;
  userId: string;
  kind: ReportKind;
  propertyIds: string[];
  frequency: ScheduleFrequency;
  options: ScheduleOptions;
  language: "en" | "de";
  lastSentOn: string | null;
  stoppedReason: string | null;
}

const columns = (a = "") =>
  `${a}id, ${a}user_id, ${a}kind, ${a}property_ids, ${a}frequency, ${a}options, ${a}language, to_char(${a}last_sent_on, 'YYYY-MM-DD') as last_sent_on, ${a}stopped_reason`;
type Row = { id: string; user_id: string; kind: ReportKind; property_ids: string[]; frequency: ScheduleFrequency; options: ScheduleOptions; language: "en" | "de"; last_sent_on: string | null; stopped_reason: string | null };
const toSchedule = (r: Row): ReportSchedule => ({ id: r.id, userId: r.user_id, kind: r.kind, propertyIds: r.property_ids, frequency: r.frequency, options: r.options, language: r.language, lastSentOn: r.last_sent_on, stoppedReason: r.stopped_reason });

/** A user schedules a report for themself (the caller checked the report's right at each property). */
export async function createReportSchedule(pool: Pool, schema: string, input: Omit<ReportSchedule, "id" | "lastSentOn" | "stoppedReason">): Promise<string> {
  if (!REPORT_KINDS.includes(input.kind)) throw new Error("Unknown report");
  if (!SCHEDULE_FREQUENCIES.includes(input.frequency)) throw new Error("Daily, weekly or monthly");
  if (!input.propertyIds.length || !input.propertyIds.every(isUuid)) throw new Error("Choose a property");
  return withTenant(pool, schema, async (tx) => {
    const known = (await tx.query("select 1 from properties where id = any($1::uuid[])", [input.propertyIds])).rowCount;
    if (known !== input.propertyIds.length) throw new Error("Property not found");
    const { rows } = await tx.query<{ id: string }>(
      "insert into report_schedules (user_id, kind, property_ids, frequency, options, language) values ($1, $2, $3, $4, $5, $6) returning id",
      [input.userId, input.kind, input.propertyIds, input.frequency, JSON.stringify(input.options), input.language],
    );
    return rows[0]!.id;
  });
}

export async function listReportSchedules(pool: Pool, schema: string, userId: string): Promise<ReportSchedule[]> {
  return withTenant(pool, schema, async (tx) => (await tx.query<Row>(`select ${columns()} from report_schedules where user_id = $1 order by created_at`, [userId])).rows.map(toSchedule));
}

/** A user removes one of their own schedules. */
export async function deleteReportSchedule(pool: Pool, schema: string, id: string, userId: string): Promise<void> {
  if (!isUuid(id)) throw new Error("Schedule not found");
  const n = await withTenant(pool, schema, async (tx) => (await tx.query("delete from report_schedules where id = $1 and user_id = $2", [id, userId])).rowCount);
  if (!n) throw new Error("Schedule not found");
}

/** The schedules due now, by the local time of their first property, with that local date. */
export async function dueReportSchedules(pool: Pool, schema: string, now = new Date()): Promise<(ReportSchedule & { localDate: string })[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<Row & { local_date: string; local_hour: number }>(
      `select ${columns("s.")},
         to_char(($1::timestamptz at time zone p.time_zone)::date, 'YYYY-MM-DD') as local_date, extract(hour from $1::timestamptz at time zone p.time_zone)::int as local_hour
       from report_schedules s join properties p on p.id = s.property_ids[1] where s.stopped_at is null`,
      [now],
    );
    return rows.filter((r) => scheduleDue(r.frequency, { date: r.local_date, hour: r.local_hour }, r.last_sent_on)).map((r) => ({ ...toSchedule(r), localDate: r.local_date }));
  });
}

export async function markReportScheduleSent(pool: Pool, schema: string, id: string, localDate: string): Promise<void> {
  await withTenant(pool, schema, (tx) => tx.query("update report_schedules set last_sent_on = $2 where id = $1", [id, localDate]));
}

/** Stop a schedule whose user may no longer see the report; it stays listed with the reason. */
export async function stopReportSchedule(pool: Pool, schema: string, id: string, reason: string): Promise<void> {
  await withTenant(pool, schema, (tx) => tx.query("update report_schedules set stopped_at = now(), stopped_reason = $2 where id = $1 and stopped_at is null", [id, reason]));
}
