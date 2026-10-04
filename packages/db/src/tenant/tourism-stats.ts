import type { Pool, PoolClient } from "pg";
import { addDays, countMonth, monthBounds, roundMoney, statsRowFor, statsRows, statsVariant, type StatsVariant } from "@hoteloftware/domain";
import { checkDate, isUuid } from "./catalogue-common";
import { withTenant } from "./with-tenant";

/**
 * Official tourism statistics (ticket 85): per property and calendar month,
 * persons by country of residence (arrivals in the month, every night in
 * it) and the capacity figures of the country's form, from the stays, the
 * dated bed history and the opening calendar. Submitted reports are frozen;
 * a correction is a new version. No direct transmission.
 */

export interface TourismReportData {
  variant: StatsVariant;
  month: string;
  property: { name: string; identity: string; country: string };
  rows: { key: string; label: { de: string; en: string }; arrivals: number; nights: number }[];
  totals: { arrivals: number; nights: number };
  capacity: {
    /** Bed places on the last opening day of the month (double beds count two; no extra beds or cots). */
    bedPlaces: number;
    extraBeds: number;
    rooms: number;
    openingDays: number;
    /** Germany, from 25 rooms: room days offered and occupied. Switzerland: occupied rooms. */
    roomDaysOffered: number;
    roomDaysOccupied: number;
    /** Switzerland: accommodation takings per person and night (gross, from the stays' room Charges). */
    takingsPerPersonNight: number | null;
  };
  /** Closed periods overlapping the month (Germany: temporary closed period and reopening). */
  closedPeriods: { from: string; to: string; reason: string }[];
  /** Stays left out, with the reason. */
  excluded: { reservationId: string; confirmationNumber: string; guestName: string; reason: string }[];
  /** Stays whose guest has no country of residence (counted as "not stated") or, in Austria, no postal code. */
  incomplete: { reservationId: string; confirmationNumber: string; guestName: string; missing: "country" | "postal_code" }[];
}

interface PropertyRow {
  name: string;
  country: string;
  stats_identity: string;
  stats_deadline_day: number;
  currency: string;
}

async function propertyOf(tx: PoolClient, propertyId: string): Promise<PropertyRow> {
  const p = (await tx.query<PropertyRow>("select name, country, stats_identity, stats_deadline_day, currency from properties where id = $1", [propertyId])).rows[0];
  if (!p) throw new Error("Property not found");
  return p;
}

function checkMonth(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("A month as YYYY-MM");
  return month;
}

/** The report as the stays stand now. */
async function computeIn(tx: PoolClient, propertyId: string, month: string): Promise<TourismReportData> {
  const p = await propertyOf(tx, propertyId);
  const variant = statsVariant(p.country);
  if (!variant) throw new Error(`No official statistics form for ${p.country}`);
  const { from, to } = monthBounds(checkMonth(month));
  const last = addDays(to, -1);

  // stays that took a bed: in house or left, overlapping the month or arriving in it
  const stays = (await tx.query<{ id: string; confirmation_number: string; first_name: string; last_name: string; arrival: string; departure: string; persons: number; country: string | null; postal_code: string | null; excluded: string | null }>(
    `select r.id, b.confirmation_number, g.first_name, g.last_name, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure,
       r.adults + cardinality(r.child_ages) as persons, g.country_of_residence as country, g.postal_code, r.stats_excluded_reason as excluded
     from reservations r join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id
     where r.property_id = $1 and r.status in ('checked_in', 'checked_out') and r.arrival < $3 and r.departure > $2
     order by r.arrival, b.confirmation_number`,
    [propertyId, from, to],
  )).rows;
  const name = (s: { first_name: string; last_name: string }) => `${s.first_name} ${s.last_name}`.trim();
  const counted = stays.filter((s) => !s.excluded);
  const incomplete: TourismReportData["incomplete"] = [];
  for (const s of counted) {
    if (!s.country) incomplete.push({ reservationId: s.id, confirmationNumber: s.confirmation_number, guestName: name(s), missing: "country" });
    else if (variant === "AT" && (s.country === "AT" || s.country === "DE") && !s.postal_code?.trim()) incomplete.push({ reservationId: s.id, confirmationNumber: s.confirmation_number, guestName: name(s), missing: "postal_code" });
  }
  const count = countMonth(
    counted.map((s) => ({ arrival: s.arrival, departure: s.departure, persons: s.persons, row: statsRowFor(variant, s.country, s.postal_code) })),
    month,
  );
  // the form's rows in its order; Switzerland lists each country present
  const formRows = variant === "CH" ? [...Object.keys(count.rows)].sort().map((k) => ({ key: k, label: { de: k, en: k } })) : statsRows(variant);
  const rows = formRows.map((r) => ({ ...r, arrivals: count.rows[r.key]?.arrivals ?? 0, nights: count.rows[r.key]?.nights ?? 0 }));

  // opening days: the days of the month not in a closed period
  const closedPeriods = (await tx.query<{ from_date: string; to_date: string; reason: string }>(
    "select to_char(from_date, 'YYYY-MM-DD') as from_date, to_char(to_date, 'YYYY-MM-DD') as to_date, reason from closed_periods where property_id = $1 and from_date <= $3 and to_date >= $2 order by from_date",
    [propertyId, from, last],
  )).rows;
  const days: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) days.push(d);
  const open = days.filter((d) => !closedPeriods.some((c) => c.from_date <= d && c.to_date >= d));
  const lastOpen = open.at(-1) ?? last;

  // capacity on the last opening day, from the dated bed history: a room counts from its first history entry
  // (rooms without any history, from before it was kept, count with their figures if they existed then);
  // the beds of rooms taken by stays left out of the statistics are left out with them
  const capacity = (await tx.query<{ rooms: number; bed_places: number; extra_beds: number; excluded_beds: number }>(
    `with cap as (
       select m.id,
         (select h.bed_places from room_capacity_history h where h.room_id = m.id and h.valid_from <= $2 order by h.valid_from desc limit 1) as hb,
         (select h.extra_beds from room_capacity_history h where h.room_id = m.id and h.valid_from <= $2 order by h.valid_from desc limit 1) as he,
         exists (select 1 from room_capacity_history h where h.room_id = m.id) as has_history, m.bed_places, m.extra_beds, m.created_at::date <= $2 as existed
       from rooms m where m.property_id = $1
     ), counted as (
       select id, coalesce(hb, case when not has_history and existed then bed_places end) as beds, coalesce(he, case when not has_history and existed then extra_beds end) as extra from cap
     )
     select count(*) filter (where beds is not null)::int as rooms, coalesce(sum(beds), 0)::int as bed_places, coalesce(sum(extra), 0)::int as extra_beds,
       coalesce(sum(beds) filter (where id in (
         select a.room_id from room_assignments a join reservations r on r.id = a.reservation_id
         where r.property_id = $1 and r.stats_excluded_reason is not null and r.status in ('checked_in', 'checked_out') and a.from_date <= $2 and a.to_date > $2)), 0)::int as excluded_beds
     from counted`,
    [propertyId, lastOpen],
  )).rows[0]!;
  // room nights the statistics leave out: Out of Order, and rooms of stays left out
  const notOffered = Number((await tx.query<{ n: string }>(
    `select coalesce((select sum(greatest(0, least(b.to_date, $3::date) - greatest(b.from_date, $2::date))) from room_blocks b
                      where b.property_id = $1 and b.kind = 'out_of_order' and b.from_date < $3 and b.to_date > $2), 0)
          + coalesce((select sum(greatest(0, least(a.to_date, $3::date) - greatest(a.from_date, $2::date))) from room_assignments a join reservations r on r.id = a.reservation_id
                      where r.property_id = $1 and r.stats_excluded_reason is not null and r.status in ('checked_in', 'checked_out') and a.from_date < $3 and a.to_date > $2), 0) as n`,
    [propertyId, from, to],
  )).rows[0]!.n);
  // room nights occupied in the month, from the stays' Room Assignments: each room once a night
  const occupied = Number((await tx.query<{ n: string }>(
    `select count(distinct (a.room_id, d)) as n
     from room_assignments a join reservations r on r.id = a.reservation_id
     cross join lateral generate_series(greatest(a.from_date, $2::date), least(a.to_date, $3::date) - 1, interval '1 day') d
     where r.property_id = $1 and r.status in ('checked_in', 'checked_out') and r.stats_excluded_reason is null and a.from_date < $3 and a.to_date > $2`,
    [propertyId, from, to],
  )).rows[0]!.n);
  let takings: number | null = null;
  if (variant === "CH" && count.nights > 0) {
    const room = Number((await tx.query<{ s: string }>(
      `select coalesce(sum(c.amount), 0) as s from charges c join reservations r on r.id = c.reservation_id
       where r.property_id = $1 and c.origin = 'stay' and c.voided_at is null and c.service_date >= $2 and c.service_date < $3 and r.status in ('checked_in', 'checked_out') and r.stats_excluded_reason is null`,
      [propertyId, from, to],
    )).rows[0]!.s);
    takings = roundMoney(room / count.nights);
  }
  return {
    variant,
    month,
    property: { name: p.name, identity: p.stats_identity, country: p.country },
    rows,
    totals: { arrivals: count.arrivals, nights: count.nights },
    capacity: {
      bedPlaces: capacity.bed_places - capacity.excluded_beds,
      extraBeds: capacity.extra_beds,
      rooms: capacity.rooms,
      openingDays: open.length,
      roomDaysOffered: Math.max(0, capacity.rooms * open.length - notOffered),
      roomDaysOccupied: occupied,
      takingsPerPersonNight: takings,
    },
    closedPeriods: closedPeriods.map((c) => ({ from: c.from_date, to: c.to_date, reason: c.reason })),
    excluded: stays.filter((s) => s.excluded).map((s) => ({ reservationId: s.id, confirmationNumber: s.confirmation_number, guestName: name(s), reason: s.excluded! })),
    incomplete,
  };
}

export interface TourismReportVersion {
  version: number;
  submittedAt: Date;
  submittedBy: string;
  data: TourismReportData;
}

/** The month's report as it stands now, and every submitted version (newest first). */
export async function tourismReport(pool: Pool, schema: string, propertyId: string, month: string): Promise<{ current: TourismReportData; versions: TourismReportVersion[] }> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  return withTenant(pool, schema, async (tx) => {
    const current = await computeIn(tx, propertyId, month);
    const { rows } = await tx.query<{ version: number; submitted_at: Date; submitted_by: string; data: TourismReportData }>(
      "select version, submitted_at, submitted_by, data from tourism_reports where property_id = $1 and month = $2 order by version desc",
      [propertyId, month],
    );
    return { current, versions: rows.map((r) => ({ version: r.version, submittedAt: r.submitted_at, submittedBy: r.submitted_by, data: r.data })) };
  });
}

/** Freeze the month's report as submitted; a later submission of the same month is a correction with the next version. */
export async function submitTourismReport(pool: Pool, schema: string, propertyId: string, month: string, userId: string): Promise<number> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  return withTenant(pool, schema, async (tx) => {
    // one submission of a property's month at a time
    await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`tourism:${propertyId}:${month}`]);
    const data = await computeIn(tx, propertyId, month);
    const { to } = monthBounds(month);
    const today = (await tx.query<{ d: string }>("select to_char(business_date, 'YYYY-MM-DD') as d from properties where id = $1", [propertyId])).rows[0]!.d;
    // a month is reported once it is over (its last night audited)
    if (to > today) throw new Error("A month is reported once it has ended");
    const next = (await tx.query<{ v: number }>("select coalesce(max(version), 0) + 1 as v from tourism_reports where property_id = $1 and month = $2", [propertyId, month])).rows[0]!.v;
    await tx.query("insert into tourism_reports (property_id, month, version, data, submitted_by) values ($1, $2, $3, $4, $5)", [propertyId, month, next, JSON.stringify(data), userId]);
    return next;
  });
}

export interface StatsSettings {
  identity: string;
  deadlineDay: number;
  closedPeriods: { id: string; from: string; to: string; reason: string }[];
}

export async function statsSettings(pool: Pool, schema: string, propertyId: string): Promise<StatsSettings> {
  return withTenant(pool, schema, async (tx) => {
    const p = await propertyOf(tx, propertyId);
    const closedPeriods = (await tx.query<{ id: string; from_date: string; to_date: string; reason: string }>(
      "select id, to_char(from_date, 'YYYY-MM-DD') as from_date, to_char(to_date, 'YYYY-MM-DD') as to_date, reason from closed_periods where property_id = $1 order by from_date desc limit 100",
      [propertyId],
    )).rows;
    return { identity: p.stats_identity, deadlineDay: p.stats_deadline_day, closedPeriods: closedPeriods.map((c) => ({ id: c.id, from: c.from_date, to: c.to_date, reason: c.reason })) };
  });
}

/** The statistical identity (reporting unit number) and the day of the following month the report is due. */
export async function setStatsSettings(pool: Pool, schema: string, propertyId: string, input: { identity: string; deadlineDay: number }): Promise<void> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  if (!Number.isInteger(input.deadlineDay) || input.deadlineDay < 1 || input.deadlineDay > 28) throw new Error("The deadline is a day from 1 to 28");
  await withTenant(pool, schema, async (tx) => {
    const done = await tx.query("update properties set stats_identity = $2, stats_deadline_day = $3 where id = $1", [propertyId, input.identity.trim().slice(0, 40), input.deadlineDay]);
    if (!done.rowCount) throw new Error("Property not found");
  });
}

/** A period the property is closed (both days included). */
export async function addClosedPeriod(pool: Pool, schema: string, propertyId: string, input: { from: string; to: string; reason: string }, userId: string): Promise<void> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  const from = checkDate(input.from);
  const to = checkDate(input.to || input.from);
  if (to < from) throw new Error("The end date is before the start date");
  await withTenant(pool, schema, (tx) => tx.query("insert into closed_periods (property_id, from_date, to_date, reason, created_by) values ($1, $2, $3, $4, $5)", [propertyId, from, to, input.reason.trim().slice(0, 200), userId]));
}

export async function removeClosedPeriod(pool: Pool, schema: string, propertyId: string, closedPeriodId: string): Promise<void> {
  if (!isUuid(closedPeriodId)) throw new Error("Closed period not found");
  await withTenant(pool, schema, async (tx) => {
    const done = await tx.query("delete from closed_periods where id = $1 and property_id = $2", [closedPeriodId, propertyId]);
    if (!done.rowCount) throw new Error("Closed period not found");
  });
}

/** Leave a stay out of the statistics with a reason, or count it again (null); who and when are kept. */
export async function setStatsExclusion(pool: Pool, schema: string, reservationId: string, reason: string | null, userId: string): Promise<void> {
  if (!isUuid(reservationId)) throw new Error("Reservation not found");
  const clean = reason === null ? null : reason.trim().slice(0, 200);
  if (clean === "") throw new Error("Give the reason the stay is left out");
  await withTenant(pool, schema, async (tx) => {
    const done = await tx.query("update reservations set stats_excluded_reason = $2, stats_excluded_by = $3, stats_excluded_at = clock_timestamp() where id = $1", [reservationId, clean, userId]);
    if (!done.rowCount) throw new Error("Reservation not found");
  });
}

/** The date a month's report is due: the property's deadline day of the following month. */
export function statsDeadline(month: string, deadlineDay: number): string {
  return addDays(monthBounds(month).to, deadlineDay - 1);
}

/** How many finished months back the reminder looks for a report not submitted. */
const REMINDER_MONTHS = 6;

/**
 * The oldest month whose deadline has come and that is not submitted yet,
 * of the last few finished months (the reminder), per property. One
 * transaction for all the properties the banner looks at.
 */
export async function dueTourismReports(pool: Pool, schema: string, propertyIds: string[]): Promise<Map<string, { month: string; deadline: string }>> {
  const ids = propertyIds.filter(isUuid);
  const out = new Map<string, { month: string; deadline: string }>();
  if (!ids.length) return out;
  return withTenant(pool, schema, async (tx) => {
    // months from the property's first stay on: before it, there is nothing to report
    const props = (await tx.query<{ id: string; country: string; business_date: string; stats_deadline_day: number; first_month: string | null }>(
      `select p.id, p.country, to_char(p.business_date, 'YYYY-MM-DD') as business_date, p.stats_deadline_day,
         (select to_char(min(r.arrival), 'YYYY-MM') from reservations r where r.property_id = p.id and r.status in ('checked_in', 'checked_out')) as first_month
       from properties p where p.id = any($1::uuid[])`,
      [ids],
    )).rows;
    const submitted = (await tx.query<{ property_id: string; month: string }>("select distinct property_id, month from tourism_reports where property_id = any($1::uuid[])", [ids])).rows;
    const done = new Set(submitted.map((x) => `${x.property_id}|${x.month}`));
    for (const p of props) {
      if (!statsVariant(p.country)) continue;
      let first = `${p.business_date.slice(0, 7)}-01`;
      const months: string[] = [];
      for (let k = 0; k < REMINDER_MONTHS; k++) {
        first = `${addDays(first, -1).slice(0, 7)}-01`;
        // the previous month always; earlier ones only from the first stay on
        if (k > 0 && (!p.first_month || first.slice(0, 7) < p.first_month)) break;
        months.push(first.slice(0, 7));
      }
      // oldest first: a month left behind is not forgotten when the next one falls due
      for (const month of months.reverse()) {
        const deadline = statsDeadline(month, p.stats_deadline_day);
        if (p.business_date >= deadline && !done.has(`${p.id}|${month}`)) {
          out.set(p.id, { month, deadline });
          break;
        }
      }
    }
    return out;
  });
}

/** The reminder for one property. */
export async function dueTourismReport(pool: Pool, schema: string, propertyId: string): Promise<{ month: string; deadline: string } | null> {
  return (await dueTourismReports(pool, schema, [propertyId])).get(propertyId) ?? null;
}

/** Why a stay is left out of the statistics, or null. */
export async function statsExclusionOf(pool: Pool, schema: string, reservationId: string): Promise<string | null> {
  if (!isUuid(reservationId)) return null;
  return withTenant(pool, schema, async (tx) => (await tx.query<{ r: string | null }>("select stats_excluded_reason as r from reservations where id = $1", [reservationId])).rows[0]?.r ?? null);
}
