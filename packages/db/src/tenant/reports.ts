import type { Pool, PoolClient } from "pg";
import {
  LAST_YEAR_SHIFT,
  REPORT_TEXT,
  REPORT_TITLES,
  addDays,
  convertAmount,
  convertNight,
  daysBetween,
  kpis,
  lastYearPeriod,
  occupancyRows,
  percentOf,
  previousPeriod,
  roundMoney,
  type Grain,
  type Kpis,
  type NightFigures,
  type ReportColumn,
  type ReportKind,
  type ReportRow,
  type ReportTable,
} from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { listReceivables } from "./receivables";
import { withTenant } from "./with-tenant";

/**
 * Fixed reports (ticket 82): the figures read from the tenant's records and
 * laid out as one table per report. Several properties: one row per property
 * beside the consolidated figures, amounts converted into the report's
 * currency at the rate stated on it.
 */
export interface ReportRequest {
  kind: ReportKind;
  from: string;
  to: string;
  propertyIds: string[];
  roomTypeId?: string | null;
  grain: Grain;
  /** Occupancy by room type instead of by period. */
  byRoomType?: boolean;
  compare: { previous: boolean; lastYear: boolean };
  /** Pickup: the day the gain or loss is counted from. */
  pickupSince?: string;
  /** The report currency; default the first property's. */
  currency?: string;
  /** rates[CUR]: units of the report currency per 1 CUR. */
  rates?: Record<string, number>;
  language: "en" | "de";
}

interface PropertyInfo {
  id: string;
  name: string;
  currency: string;
  timeZone: string;
  today: string;
}

async function propertiesOf(tx: PoolClient, ids: string[]): Promise<PropertyInfo[]> {
  const valid = ids.filter(isUuid);
  if (!valid.length) throw new Error("Choose a property");
  const { rows } = await tx.query<{ id: string; name: string; currency: string; time_zone: string; today: string }>(
    "select id, name, currency, time_zone, to_char((now() at time zone time_zone)::date, 'YYYY-MM-DD') as today from properties where id = any($1::uuid[]) order by name",
    [valid],
  );
  if (rows.length !== valid.length) throw new Error("Property not found");
  return rows.map((r) => ({ id: r.id, name: r.name, currency: r.currency.trim(), timeZone: r.time_zone, today: r.today }));
}

const ACTIVE = "('confirmed', 'checked_in', 'checked_out')";
/** A Charge's amount without VAT. */
const NET = "(c.amount / (1 + c.tax_rate / 100))";

/**
 * Revenue per reservation and night: posted Charges (Corrections count with
 * the component and origin they correct), and for stays not yet checked in the room
 * and Service components on the books, net at the Tax Code's rate that night.
 */
const NIGHT_REVENUE = `
  select c.reservation_id, c.service_date as date,
    sum(case when c.category = 'accommodation' and coalesce(o.origin, c.origin) <> 'fee' and coalesce(o.component, c.component) = 'room' then ${NET} else 0 end) as room,
    sum(case when coalesce(o.origin, c.origin) = 'fee' then ${NET} else 0 end) as fees,
    sum(case when c.category <> 'city_tax' then ${NET} else 0 end) as total
  from charges c left join charges o on o.id = c.corrects
  where c.property_id = $1 and c.voided_at is null and c.service_date between $2 and $3 and c.reservation_id is not null
  group by 1, 2
  union all
  select n.reservation_id, n.date,
    sum(case when n.kind = 'room' then n.amount / (1 + coalesce(tr.rate, 0) / 100) else 0 end) as room,
    0 as fees,
    sum(n.amount / (1 + coalesce(tr.rate, 0) / 100)) as total
  from reservation_night_components n
  join reservations r on r.id = n.reservation_id and r.status = 'confirmed'
  join rate_plans rp on rp.id = r.rate_plan_id
  -- the room component is the Rate Plan's accommodation Service
  join services s on s.id = coalesce(n.service_id, rp.accommodation_service_id)
  left join lateral (select t.rate from tax_code_rates t where t.tax_code_id = s.tax_code_id and t.valid_from <= n.date order by t.valid_from desc limit 1) tr on true
  where r.property_id = $1 and n.date between $2 and $3
  group by 1, 2`;

/** Nights of one property, per date (and room type): Available Rooms, occupied rooms and revenue. */
async function nightsOf(tx: PoolClient, propertyId: string, range: { from: string; to: string }, roomTypeId: string | null): Promise<(NightFigures & { roomTypeId: string; roomType: string })[]> {
  const { rows } = await tx.query<{ date: string; room_type_id: string; room_type: string; available: number; occupied: number; room: string | null; fees: string | null; total: string | null }>(
    `with d as (select generate_series($2::date, $3::date, interval '1 day')::date as date),
     rev as (${NIGHT_REVENUE}),
     rev_by as (select rev.date, r.room_type_id, sum(rev.room) as room, sum(rev.fees) as fees, sum(rev.total) as total from rev join reservations r on r.id = rev.reservation_id group by 1, 2)
     select to_char(d.date, 'YYYY-MM-DD') as date, rt.id as room_type_id, rt.name as room_type,
       (select count(*) from rooms x where x.room_type_id = rt.id
          and not exists (select 1 from room_blocks b where b.room_id = x.id and b.kind = 'out_of_order' and b.from_date <= d.date and b.to_date > d.date))::int as available,
       (select count(*) from reservation_nights rn join reservations r on r.id = rn.reservation_id
          where r.room_type_id = rt.id and rn.date = d.date and r.status in ${ACTIVE})::int as occupied,
       rb.room, rb.fees, rb.total
     from d cross join room_types rt
     left join rev_by rb on rb.date = d.date and rb.room_type_id = rt.id
     where rt.property_id = $1 and ($4::uuid is null or rt.id = $4)
     order by 1, rt.name`,
    [propertyId, range.from, range.to, roomTypeId],
  );
  return rows.map((r) => ({
    date: r.date,
    roomTypeId: r.room_type_id,
    roomType: r.room_type,
    available: r.available,
    occupied: r.occupied,
    netRoomRevenue: roundMoney(Number(r.room ?? 0)),
    fees: roundMoney(Number(r.fees ?? 0)),
    totalRevenue: roundMoney(Number(r.total ?? 0)),
  }));
}

/** Sum the room types of each date into one night. */
function perDate(nights: NightFigures[]): NightFigures[] {
  const m = new Map<string, NightFigures>();
  for (const n of nights) {
    const x = m.get(n.date) ?? { date: n.date, available: 0, occupied: 0, netRoomRevenue: 0, fees: 0, totalRevenue: 0 };
    m.set(n.date, { date: n.date, available: x.available + n.available, occupied: x.occupied + n.occupied, netRoomRevenue: x.netRoomRevenue + n.netRoomRevenue, fees: x.fees + n.fees, totalRevenue: x.totalRevenue + n.totalRevenue });
  }
  return [...m.values()];
}

const t = (req: ReportRequest, key: keyof typeof REPORT_TEXT) => REPORT_TEXT[key][req.language];

function baseNotes(req: ReportRequest, props: PropertyInfo[], currency: string): string[] {
  const notes = [`${t(req, "period")}: ${req.from} – ${req.to}`, `${t(req, "property")}: ${props.map((p) => p.name).join(", ")}`];
  const foreign = [...new Set(props.map((p) => p.currency).filter((c) => c !== currency))];
  if (foreign.length) {
    notes.push(t(req, "converted").replace("{to}", currency).replace("{rates}", foreign.map((c) => `1 ${c} = ${req.rates?.[c]} ${currency}`).join(", ")));
  }
  return notes;
}

// ── Occupancy and revenue ──

const KPI_COLUMNS: [keyof Kpis, keyof typeof REPORT_TEXT, ReportColumn["kind"]][] = [
  ["available", "available", "int"],
  ["occupied", "occupied", "int"],
  ["occupancy", "occupancy", "percent"],
  ["adr", "adr", "money"],
  ["revpar", "revpar", "money"],
  ["netRoomRevenue", "netRoomRevenue", "money"],
  ["fees", "fees", "money"],
  ["totalRevenue", "totalRevenue", "money"],
];
const COMPARED: (keyof Kpis)[] = ["occupancy", "adr", "revpar", "netRoomRevenue"];

async function occupancyReport(tx: PoolClient, req: ReportRequest, props: PropertyInfo[], currency: string): Promise<ReportTable> {
  const rates = req.rates ?? {};
  const range = { from: req.from, to: req.to };
  const prev = previousPeriod(range);
  const ly = lastYearPeriod(range);
  const load = async (r: { from: string; to: string }) =>
    Promise.all(
      props.map(async (p) => ({
        p,
        nights: (await nightsOf(tx, p.id, r, req.roomTypeId ?? null)).map((n) => ({ ...convertNight(n, p.currency, currency, rates), roomTypeId: n.roomTypeId, roomType: props.length > 1 ? `${p.name} · ${n.roomType}` : n.roomType })),
      })),
    );
  const own = await load(range);
  const previous = req.compare.previous ? (await load(prev)).flatMap((x) => x.nights) : null;
  const lastYear = req.compare.lastYear ? (await load(ly)).flatMap((x) => x.nights) : null;
  const columns: ReportColumn[] = [{ key: "label", label: req.byRoomType ? t(req, "roomType") : t(req, "period"), kind: "text" }, ...KPI_COLUMNS.map(([key, label, kind]) => ({ key, label: t(req, label), kind }))];
  for (const [flag, suffix] of [[req.compare.previous, "previous"], [req.compare.lastYear, "lastYear"]] as const) {
    if (flag) for (const k of COMPARED) columns.push({ key: `${k}_${suffix}`, label: `${t(req, KPI_COLUMNS.find((c) => c[0] === k)![1])} ${t(req, suffix)}`, kind: KPI_COLUMNS.find((c) => c[0] === k)![2] });
  }
  const cells = (label: string, k: Kpis, p?: Kpis, l?: Kpis): ReportRow["cells"] => ({
    label,
    ...Object.fromEntries(KPI_COLUMNS.map(([key]) => [key, k[key]])),
    ...(p ? Object.fromEntries(COMPARED.map((key) => [`${key}_previous`, p[key]])) : {}),
    ...(l ? Object.fromEntries(COMPARED.map((key) => [`${key}_lastYear`, l[key]])) : {}),
  });
  const all = own.flatMap((x) => x.nights);
  const rows: ReportRow[] = [];
  if (req.byRoomType) {
    const types = [...new Map(all.map((n) => [n.roomTypeId, n.roomType])).entries()];
    for (const [id, name] of types) {
      const of = (ns: typeof all | null) => (ns ? kpis(ns.filter((n) => n.roomTypeId === id)) : undefined);
      rows.push({ cells: cells(name, of(all)!, of(previous), of(lastYear)) });
    }
  } else {
    const prevNights = previous ? { nights: perDate(previous), shift: prev.shift } : undefined;
    const lyNights = lastYear ? { nights: perDate(lastYear), shift: ly.shift } : undefined;
    for (const r of occupancyRows(perDate(all), req.grain, { ...(prevNights ? { previous: prevNights } : {}), ...(lyNights ? { lastYear: lyNights } : {}) })) {
      rows.push({ cells: cells(r.period, r, r.previous, r.lastYear) });
    }
  }
  // one line per property beside the consolidated total
  if (props.length > 1) {
    for (const { p, nights } of own) {
      // a property's room types are its own: they pick its nights out of the comparisons
      const roomTypes = new Set(nights.map((n) => n.roomTypeId));
      const mine = (ns: typeof all | null) => (ns ? kpis(ns.filter((n) => roomTypes.has(n.roomTypeId))) : undefined);
      rows.push({ cells: cells(p.name, kpis(nights), mine(previous), mine(lastYear)), emphasis: true });
    }
  }
  rows.push({ cells: cells(t(req, "total"), kpis(all), previous ? kpis(previous) : undefined, lastYear ? kpis(lastYear) : undefined), emphasis: true });
  const notes = [...baseNotes(req, props, currency), t(req, "baseAvailable")];
  if (req.compare.previous || req.compare.lastYear) notes.push(t(req, "lastYearNote"));
  return { title: REPORT_TITLES.occupancy[req.language], notes, columns, rows };
}

// ── Pickup and pace ──

async function pickupReport(tx: PoolClient, req: ReportRequest, props: PropertyInfo[], currency: string): Promise<ReportTable> {
  const rates = req.rates ?? {};
  const since = req.pickupSince ?? addDays(props[0]!.today, -7);
  const byDate = new Map<string, { otb: number; pickN: number; pickR: number; available: number; ly: number; lyAvailable: number }>();
  for (const p of props) {
    // the stay as it stands, and as it stood at the start of the chosen day (property time); last year the same, 364 days earlier.
    // Each part is aggregated per date once, then joined: no per-date scans.
    const { rows } = await tx.query<{ date: string; available: number; otb: number; then_n: number; now_r: string; then_r: string; ly: number; ly_available: number }>(
      `with d as (select generate_series($2::date, $3::date, interval '1 day')::date as date),
       types as (select id from room_types where property_id = $1 and ($6::uuid is null or id = $6)),
       cut as (select ($4::date)::timestamp at time zone $5 as at, now() - interval '${LAST_YEAR_SHIFT} days' as ly_at),
       room_count as (select count(*)::int as n from rooms where room_type_id in (select id from types)),
       ooo as (
         select d.date, count(b.id)::int as n from d join room_blocks b on b.kind = 'out_of_order' and b.room_id in (select x.id from rooms x where x.room_type_id in (select id from types))
           and b.from_date <= d.date and b.to_date > d.date group by d.date
       ),
       ooo_ly as (
         select d.date, count(b.id)::int as n from d join room_blocks b on b.kind = 'out_of_order' and b.room_id in (select x.id from rooms x where x.room_type_id in (select id from types))
           and b.from_date <= d.date - ${LAST_YEAR_SHIFT} and b.to_date > d.date - ${LAST_YEAR_SHIFT} group by d.date
       ),
       stays as (
         select rn.date, r.id, r.status, r.created_at, r.cancelled_at from reservation_nights rn join reservations r on r.id = rn.reservation_id
         where r.property_id = $1 and r.room_type_id in (select id from types)
           and (rn.date between $2 and $3 or rn.date between ($2::date - ${LAST_YEAR_SHIFT}) and ($3::date - ${LAST_YEAR_SHIFT}))
       ),
       -- on the books at a moment: made before it and not yet cancelled (a later No-show was on the books then)
       held_then as (select s.* from stays s, cut where s.created_at < cut.at and (s.cancelled_at is null or s.cancelled_at >= cut.at)),
       held_ly as (select s.* from stays s, cut where s.created_at < cut.ly_at and (s.cancelled_at is null or s.cancelled_at >= cut.ly_at)),
       rev as (${NIGHT_REVENUE}),
       now_n as (select date, count(*)::int as n from stays where status in ${ACTIVE} group by date),
       then_n as (select date, count(*)::int as n from held_then group by date),
       ly_n as (select date + ${LAST_YEAR_SHIFT} as date, count(*)::int as n from held_ly group by date),
       now_r as (select rev.date, sum(rev.room) as v from rev join stays s on s.id = rev.reservation_id and s.date = rev.date where s.status in ${ACTIVE} group by rev.date),
       then_r as (select rev.date, sum(rev.room) as v from rev join held_then h on h.id = rev.reservation_id and h.date = rev.date group by rev.date)
       select to_char(d.date, 'YYYY-MM-DD') as date,
         (select n from room_count) - coalesce(ooo.n, 0) as available,
         coalesce(now_n.n, 0) as otb, coalesce(then_n.n, 0) as then_n, coalesce(now_r.v, 0) as now_r, coalesce(then_r.v, 0) as then_r,
         coalesce(ly_n.n, 0) as ly, (select n from room_count) - coalesce(ooo_ly.n, 0) as ly_available
       from d left join ooo on ooo.date = d.date left join ooo_ly on ooo_ly.date = d.date left join now_n on now_n.date = d.date left join then_n on then_n.date = d.date
         left join ly_n on ly_n.date = d.date left join now_r on now_r.date = d.date left join then_r on then_r.date = d.date
       order by 1`,
      [p.id, req.from, req.to, since, p.timeZone, req.roomTypeId ?? null],
    );
    for (const r of rows) {
      const x = byDate.get(r.date) ?? { otb: 0, pickN: 0, pickR: 0, available: 0, ly: 0, lyAvailable: 0 };
      byDate.set(r.date, {
        otb: x.otb + r.otb,
        pickN: x.pickN + r.otb - r.then_n,
        pickR: roundMoney(x.pickR + convertAmount(Number(r.now_r) - Number(r.then_r), p.currency, currency, rates)),
        available: x.available + r.available,
        ly: x.ly + r.ly,
        lyAvailable: x.lyAvailable + r.ly_available,
      });
    }
  }
  const rows: ReportRow[] = [...byDate.entries()].map(([date, x]) => ({ cells: { date, otb: x.otb, pickN: x.pickN, pickR: x.pickR, occ: percentOf(x.otb, x.available), ly: percentOf(x.ly, x.lyAvailable) } }));
  const sum = (k: "otb" | "pickN" | "pickR" | "available" | "ly" | "lyAvailable") => [...byDate.values()].reduce((s, x) => s + x[k], 0);
  rows.push({ cells: { date: t(req, "total"), otb: sum("otb"), pickN: sum("pickN"), pickR: roundMoney(sum("pickR")), occ: percentOf(sum("otb"), sum("available")), ly: percentOf(sum("ly"), sum("lyAvailable")) }, emphasis: true });
  return {
    title: REPORT_TITLES.pickup[req.language],
    notes: [...baseNotes(req, props, currency), t(req, "pickupNote").replace("{since}", since), t(req, "baseAvailable")],
    columns: [
      { key: "date", label: t(req, "date"), kind: "text" },
      { key: "otb", label: t(req, "onTheBooks"), kind: "int" },
      { key: "pickN", label: t(req, "pickupNights"), kind: "int" },
      { key: "pickR", label: t(req, "pickupRevenue"), kind: "money" },
      { key: "occ", label: t(req, "otbOccupancy"), kind: "percent" },
      { key: "ly", label: t(req, "lyOccupancy"), kind: "percent" },
    ],
    rows,
  };
}

// ── Source and channel mix ──

async function sourceMixReport(tx: PoolClient, req: ReportRequest, props: PropertyInfo[], currency: string): Promise<ReportTable> {
  const rates = req.rates ?? {};
  const bySource = new Map<string, { nights: number; revenue: number; direct: boolean }>();
  for (const p of props) {
    const { rows } = await tx.query<{ source: string; channel: string | null; walk_in: boolean; nights: number; revenue: string }>(
      `with rev as (${NIGHT_REVENUE})
       select b.source, b.channel_name as channel, b.walk_in, count(*)::int as nights,
         coalesce(sum((select sum(rev.room) from rev where rev.reservation_id = r.id and rev.date = rn.date)), 0) as revenue
       from reservation_nights rn join reservations r on r.id = rn.reservation_id join bookings b on b.id = r.booking_id
       where r.property_id = $1 and rn.date between $2 and $3 and r.status in ${ACTIVE} and ($4::uuid is null or r.room_type_id = $4)
       group by 1, 2, 3`,
      [p.id, req.from, req.to, req.roomTypeId ?? null],
    );
    for (const r of rows) {
      const label = r.source === "direct" ? (r.walk_in ? t(req, "walkIn") : t(req, "direct")) : r.channel || r.source;
      const x = bySource.get(label) ?? { nights: 0, revenue: 0, direct: r.source === "direct" };
      bySource.set(label, { ...x, nights: x.nights + r.nights, revenue: roundMoney(x.revenue + convertAmount(Number(r.revenue), p.currency, currency, rates)) });
    }
  }
  const totalNights = [...bySource.values()].reduce((s, x) => s + x.nights, 0);
  const totalRevenue = roundMoney([...bySource.values()].reduce((s, x) => s + x.revenue, 0));
  const share = (n: number) => percentOf(n, totalNights);
  const rows: ReportRow[] = [...bySource.entries()]
    .sort((a, b) => b[1].nights - a[1].nights)
    .map(([source, x]) => ({ cells: { source, nights: x.nights, share: share(x.nights), revenue: x.revenue, adr: x.nights ? roundMoney(x.revenue / x.nights) : null } }));
  const direct = [...bySource.values()].filter((x) => x.direct).reduce((s, x) => s + x.nights, 0);
  rows.push({ cells: { source: t(req, "directShare"), nights: direct, share: share(direct), revenue: null, adr: null }, emphasis: true });
  rows.push({ cells: { source: t(req, "total"), nights: totalNights, share: totalNights ? 100 : null, revenue: totalRevenue, adr: totalNights ? roundMoney(totalRevenue / totalNights) : null }, emphasis: true });
  return {
    title: REPORT_TITLES.source_mix[req.language],
    notes: [...baseNotes(req, props, currency), t(req, "sourceNote")],
    columns: [
      { key: "source", label: `${t(req, "source")} / ${t(req, "channel")}`, kind: "text" },
      { key: "nights", label: t(req, "roomNights"), kind: "int" },
      { key: "share", label: t(req, "share"), kind: "percent" },
      { key: "revenue", label: t(req, "netRoomRevenue"), kind: "money" },
      { key: "adr", label: t(req, "adr"), kind: "money" },
    ],
    rows,
  };
}

// ── Cancellations and no-shows ──

async function cancellationsReport(tx: PoolClient, req: ReportRequest, props: PropertyInfo[], currency: string): Promise<ReportTable> {
  const rates = req.rates ?? {};
  const rows: ReportRow[] = [];
  const total = { cancellations: 0, lost: 0, charged: 0, waived: 0, leadSum: 0, noShows: 0, noShowLost: 0, noShowFees: 0 };
  for (const p of props) {
    const c = (await tx.query<{ n: number; lost: number; charged: string; waived: string; lead: number }>(
      `select count(*)::int as n, coalesce(sum(r.departure - r.arrival), 0)::int as lost,
         coalesce(sum(r.cancellation_fee) filter (where r.cancellation_fee_status in ('open', 'confirmed')), 0) as charged,
         coalesce(sum(r.cancellation_fee) filter (where r.cancellation_fee_status = 'waived'), 0) as waived,
         coalesce(sum(greatest(r.arrival - (r.cancelled_at at time zone $4)::date, 0)), 0)::int as lead
       from reservations r where r.property_id = $1 and r.status = 'cancelled' and (r.cancelled_at at time zone $4)::date between $2 and $3 and ($5::uuid is null or r.room_type_id = $5)`,
      [p.id, req.from, req.to, p.timeZone, req.roomTypeId ?? null],
    )).rows[0]!;
    const ns = (await tx.query<{ n: number; lost: number; fees: string }>(
      `select count(*)::int as n, coalesce(sum(r.departure - r.arrival), 0)::int as lost,
         coalesce(sum((select sum(c.amount / (1 + c.tax_rate / 100)) from charges c left join charges o on o.id = c.corrects
           where c.reservation_id = r.id and coalesce(o.origin, c.origin) = 'fee' and c.voided_at is null)), 0) as fees
       from reservations r where r.property_id = $1 and r.status = 'no_show' and r.arrival between $2 and $3 and ($4::uuid is null or r.room_type_id = $4)`,
      [p.id, req.from, req.to, req.roomTypeId ?? null],
    )).rows[0]!;
    const money = (v: string) => convertAmount(roundMoney(Number(v)), p.currency, currency, rates);
    const line = { cancellations: c.n, lost: c.lost, charged: money(c.charged), waived: money(c.waived), lead: c.n ? Math.round((c.lead / c.n) * 10) / 10 : null, noShows: ns.n, noShowLost: ns.lost, noShowFees: money(ns.fees) };
    if (props.length > 1) rows.push({ cells: { label: p.name, ...line } });
    total.cancellations += c.n;
    total.lost += c.lost;
    total.charged += line.charged;
    total.waived += line.waived;
    total.leadSum += c.lead;
    total.noShows += ns.n;
    total.noShowLost += ns.lost;
    total.noShowFees += line.noShowFees;
  }
  rows.push({
    cells: { label: t(req, "total"), cancellations: total.cancellations, lost: total.lost, charged: roundMoney(total.charged), waived: roundMoney(total.waived), lead: total.cancellations ? Math.round((total.leadSum / total.cancellations) * 10) / 10 : null, noShows: total.noShows, noShowLost: total.noShowLost, noShowFees: roundMoney(total.noShowFees) },
    emphasis: true,
  });
  return {
    title: REPORT_TITLES.cancellations[req.language],
    notes: [...baseNotes(req, props, currency), t(req, "cancellationNote")],
    columns: [
      { key: "label", label: t(req, "property"), kind: "text" },
      { key: "cancellations", label: t(req, "cancellations"), kind: "int" },
      { key: "lost", label: t(req, "lostNights"), kind: "int" },
      { key: "charged", label: t(req, "feesCharged"), kind: "money" },
      { key: "waived", label: t(req, "feesWaived"), kind: "money" },
      { key: "lead", label: t(req, "leadDays"), kind: "days" },
      { key: "noShows", label: t(req, "noShows"), kind: "int" },
      { key: "noShowLost", label: t(req, "lostNights"), kind: "int" },
      { key: "noShowFees", label: t(req, "noShowFees"), kind: "money" },
    ],
    rows,
  };
}

// ── Revenue by Service and Tax Code ──

async function revenueByCodeReport(tx: PoolClient, req: ReportRequest, props: PropertyInfo[], currency: string): Promise<ReportTable> {
  const rates = req.rates ?? {};
  const lines = new Map<string, { category: string; service: string; taxCode: string; rate: number; net: number; vat: number; gross: number }>();
  for (const p of props) {
    const { rows } = await tx.query<{ category: string; service: string; tax_code: string; rate: string; gross: string; net: string }>(
      `select c.category, coalesce(s.name, case when c.origin = 'fee' then 'Fee' else c.description end) as service, tc.code as tax_code, c.tax_rate as rate,
         sum(c.amount) as gross, sum(${NET}) as net
       from charges c left join services s on s.id = c.service_id join tax_codes tc on tc.id = c.tax_code_id
       where c.property_id = $1 and c.voided_at is null and c.service_date between $2 and $3
       group by 1, 2, 3, 4`,
      [p.id, req.from, req.to],
    );
    for (const r of rows) {
      const key = `${r.category}|${r.service}|${r.tax_code}|${r.rate}`;
      const x = lines.get(key) ?? { category: r.category, service: r.service, taxCode: r.tax_code, rate: Number(r.rate), net: 0, vat: 0, gross: 0 };
      const gross = convertAmount(roundMoney(Number(r.gross)), p.currency, currency, rates);
      const net = convertAmount(roundMoney(Number(r.net)), p.currency, currency, rates);
      lines.set(key, { ...x, gross: roundMoney(x.gross + gross), net: roundMoney(x.net + net), vat: roundMoney(x.vat + gross - net) });
    }
  }
  const sorted = [...lines.values()].sort((a, b) => a.category.localeCompare(b.category) || a.service.localeCompare(b.service));
  const rows: ReportRow[] = sorted.map((l) => ({ cells: { category: l.category, service: l.service, taxCode: l.taxCode, rate: l.rate, net: l.net, vat: l.vat, gross: l.gross } }));
  // per tax rate, then the total
  const byRate = new Map<string, { net: number; vat: number; gross: number }>();
  for (const l of sorted) {
    const k = `${l.taxCode} ${l.rate.toFixed(2)} %`;
    const x = byRate.get(k) ?? { net: 0, vat: 0, gross: 0 };
    byRate.set(k, { net: roundMoney(x.net + l.net), vat: roundMoney(x.vat + l.vat), gross: roundMoney(x.gross + l.gross) });
  }
  for (const [k, x] of byRate) rows.push({ cells: { category: "", service: k, taxCode: "", rate: null, ...x }, emphasis: true });
  const sum = (k: "net" | "vat" | "gross") => roundMoney(sorted.reduce((s, l) => s + l[k], 0));
  rows.push({ cells: { category: t(req, "total"), service: "", taxCode: "", rate: null, net: sum("net"), vat: sum("vat"), gross: sum("gross") }, emphasis: true });
  return {
    title: REPORT_TITLES.revenue_by_code[req.language],
    notes: [...baseNotes(req, props, currency), t(req, "revenueNote")],
    columns: [
      { key: "category", label: t(req, "category"), kind: "text" },
      { key: "service", label: t(req, "service"), kind: "text" },
      { key: "taxCode", label: t(req, "taxCode"), kind: "text" },
      { key: "rate", label: t(req, "rate"), kind: "percent" },
      { key: "net", label: t(req, "net"), kind: "money" },
      { key: "vat", label: t(req, "vat"), kind: "money" },
      { key: "gross", label: t(req, "gross"), kind: "money" },
    ],
    rows,
  };
}

// ── Housekeeping performance ──

async function housekeepingReport(tx: PoolClient, req: ReportRequest, props: PropertyInfo[]): Promise<ReportTable> {
  const rows: ReportRow[] = [];
  for (const p of props) {
    const { rows: people } = await tx.query<{ name: string | null; days: number; rooms: number; planned: number; actual: number; failed: number; declined: number }>(
      `select u.name, count(distinct t.business_date) filter (where t.status = 'done')::int as days,
         count(*) filter (where t.status = 'done')::int as rooms,
         coalesce(sum(t.minutes) filter (where t.status = 'done'), 0)::int as planned,
         coalesce(round(sum(extract(epoch from (t.done_at - t.started_at)) / 60) filter (where t.status = 'done' and t.started_at is not null)), 0)::int as actual,
         (select count(*) from room_cleanliness_changes x join housekeeping_tasks y on y.room_id = x.room_id and y.business_date = x.business_date
            where x.property_id = $1 and x.source = 'inspection' and x.after = 'dirty' and y.assignee_id is not distinct from t.assignee_id and x.business_date between $2 and $3)::int as failed,
         count(*) filter (where t.skip_reason is not null)::int as declined
       from housekeeping_tasks t left join control."user" u on u.id = t.assignee_id
       where t.property_id = $1 and t.business_date between $2 and $3 and t.assignee_id is not null
       group by t.assignee_id, u.name order by u.name`,
      [p.id, req.from, req.to],
    );
    for (const x of people) {
      rows.push({
        cells: { property: p.name, person: x.name ?? "–", days: x.days, rooms: x.rooms, perDay: x.days ? Math.round((x.rooms / x.days) * 10) / 10 : null, planned: x.planned, actual: x.actual, failed: x.failed, declined: x.declined },
      });
    }
  }
  const sum = (k: string) => rows.reduce((s, r) => s + Number(r.cells[k] ?? 0), 0);
  rows.push({ cells: { property: t(req, "total"), person: props.length > 1 ? "" : t(req, "total"), days: sum("days"), rooms: sum("rooms"), perDay: sum("days") ? Math.round((sum("rooms") / sum("days")) * 10) / 10 : null, planned: sum("planned"), actual: sum("actual"), failed: sum("failed"), declined: sum("declined") }, emphasis: true });
  return {
    title: REPORT_TITLES.housekeeping[req.language],
    notes: [...baseNotes(req, props, props[0]!.currency), t(req, "housekeepingNote")],
    columns: [
      ...(props.length > 1 ? [{ key: "property", label: t(req, "property"), kind: "text" as const }] : []),
      { key: "person", label: t(req, "person"), kind: "text" },
      { key: "days", label: t(req, "days"), kind: "int" },
      { key: "rooms", label: t(req, "rooms"), kind: "int" },
      { key: "perDay", label: t(req, "roomsPerDay"), kind: "days" },
      { key: "planned", label: t(req, "plannedMinutes"), kind: "int" },
      { key: "actual", label: t(req, "actualMinutes"), kind: "int" },
      { key: "failed", label: t(req, "inspectionFailures"), kind: "int" },
      { key: "declined", label: t(req, "declined"), kind: "int" },
    ],
    rows,
  };
}

// ── Receivables ageing ──

/** Ages by invoice date ("Reporting scope"): days since the invoice was issued, at the end of the period. */
const INVOICE_AGES = ["0_30", "31_60", "61_90", "over_90"] as const;
const AGE_TEXT: Record<(typeof INVOICE_AGES)[number], keyof typeof REPORT_TEXT> = { "0_30": "d30", "31_60": "d60", "61_90": "d90", over_90: "older" };
const ageOf = (days: number): (typeof INVOICE_AGES)[number] => (days <= 30 ? "0_30" : days <= 60 ? "31_60" : days <= 90 ? "61_90" : "over_90");

async function receivablesReport(pool: Pool, schema: string, req: ReportRequest, props: PropertyInfo[], currency: string): Promise<ReportTable> {
  const rates = req.rates ?? {};
  const byBillTo = new Map<string, Record<string, number>>();
  for (const p of props) {
    const r = await listReceivables(pool, schema, p.id);
    // invoices issued by the end of the period, still open today
    for (const row of r.rows.filter((x) => x.issueDate <= req.to)) {
      const key = props.length > 1 ? `${p.name} · ${row.billToName}` : row.billToName;
      const x = byBillTo.get(key) ?? Object.fromEntries([...INVOICE_AGES, "open"].map((b) => [b, 0]));
      const open = convertAmount(row.open, r.currency, currency, rates);
      const age = ageOf(daysBetween(row.issueDate, req.to));
      x[age] = roundMoney(x[age]! + open);
      x.open = roundMoney(x.open! + open);
      byBillTo.set(key, x);
    }
  }
  const rows: ReportRow[] = [...byBillTo.entries()].sort((a, b) => b[1].open! - a[1].open!).map(([billTo, x]) => ({ cells: { billTo, ...x } }));
  const totals = Object.fromEntries([...INVOICE_AGES, "open"].map((b) => [b, roundMoney([...byBillTo.values()].reduce((s, x) => s + x[b]!, 0))]));
  rows.push({ cells: { billTo: t(req, "total"), ...totals }, emphasis: true });
  return {
    title: REPORT_TITLES.receivables[req.language],
    notes: [...baseNotes(req, props, currency), t(req, "receivablesNote").replaceAll("{date}", req.to)],
    columns: [
      { key: "billTo", label: t(req, "billTo"), kind: "text" },
      ...INVOICE_AGES.map((b) => ({ key: b, label: t(req, AGE_TEXT[b]), kind: "money" as const })),
      { key: "open", label: t(req, "open"), kind: "money" },
    ],
    rows,
  };
}

// ── Cash ──

async function cashReport(tx: PoolClient, req: ReportRequest, props: PropertyInfo[], currency: string): Promise<ReportTable> {
  const rates = req.rates ?? {};
  const rows: ReportRow[] = [];
  for (const p of props) {
    const money = (v: string | number) => convertAmount(roundMoney(Number(v)), p.currency, currency, rates);
    const registers = (await tx.query<{ name: string; cash_in: string; cash_out: string; paid_outs: string; deposits: string; differences: string }>(
      `select g.name,
         coalesce(sum(m.amount) filter (where m.amount > 0 and m.kind not in ('transfer_in', 'difference')), 0) as cash_in,
         coalesce(-sum(m.amount) filter (where m.amount < 0 and m.kind not in ('transfer_out', 'difference')), 0) as cash_out,
         coalesce(-sum(m.amount) filter (where m.kind = 'paid_out'), 0) as paid_outs,
         coalesce(-sum(m.amount) filter (where m.kind = 'deposit'), 0) as deposits,
         coalesce(sum(m.amount) filter (where m.kind = 'difference'), 0) as differences
       from cash_registers g left join cash_movements m on m.register_id = g.id and m.business_date between $2 and $3
       where g.property_id = $1 group by g.id, g.name order by g.name`,
      [p.id, req.from, req.to],
    )).rows;
    for (const g of registers) {
      rows.push({ cells: { label: props.length > 1 ? `${p.name} · ${g.name}` : g.name, cashIn: money(g.cash_in), cashOut: money(g.cash_out), paidOuts: money(g.paid_outs), deposits: money(g.deposits), shifts: null, differences: money(g.differences) } });
    }
    // a Cash Difference is booked on the Business Date its Shift closed on, like every Cash Book entry
    const people = (await tx.query<{ name: string | null; shifts: number; difference: string }>(
      `select u.name, count(distinct m.shift_id)::int as shifts, coalesce(sum(m.amount), 0) as difference
       from cash_movements m join cash_shifts s on s.id = m.shift_id left join control."user" u on u.id = s.user_id
       where m.property_id = $1 and m.kind = 'difference' and m.business_date between $2 and $3
       group by s.user_id, u.name order by u.name`,
      [p.id, req.from, req.to],
    )).rows;
    for (const u of people) {
      rows.push({ cells: { label: `${t(req, "user")}: ${u.name ?? "–"}${props.length > 1 ? ` (${p.name})` : ""}`, cashIn: null, cashOut: null, paidOuts: null, deposits: null, shifts: u.shifts, differences: money(u.difference) }, emphasis: true });
    }
  }
  return {
    title: REPORT_TITLES.cash[req.language],
    notes: [...baseNotes(req, props, currency), t(req, "cashNote")],
    columns: [
      { key: "label", label: `${t(req, "register")} / ${t(req, "user")}`, kind: "text" },
      { key: "cashIn", label: t(req, "cashIn"), kind: "money" },
      { key: "cashOut", label: t(req, "cashOut"), kind: "money" },
      { key: "paidOuts", label: t(req, "paidOuts"), kind: "money" },
      { key: "deposits", label: t(req, "deposits"), kind: "money" },
      { key: "shifts", label: t(req, "shifts"), kind: "int" },
      { key: "differences", label: t(req, "differences"), kind: "money" },
    ],
    rows,
  };
}

/** Every currency other than the report's needs its rate stated, whether or not the period holds amounts in it. */
function checkRates(req: ReportRequest, props: PropertyInfo[], currency: string): void {
  if (req.kind === "housekeeping") return;
  for (const c of new Set(props.map((p) => p.currency))) convertAmount(0, c, currency, req.rates ?? {});
}

/** One of the fixed reports as a table. The caller has checked the report's right at every property asked for. */
export async function runReport(pool: Pool, schema: string, req: ReportRequest): Promise<ReportTable> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.from) || !/^\d{4}-\d{2}-\d{2}$/.test(req.to) || req.to < req.from) throw new Error("Choose a date range");
  if (daysBetween(req.from, req.to) > 731) throw new Error("A report covers two years at most");
  if (req.roomTypeId && !isUuid(req.roomTypeId)) throw new Error("Room type not found");
  if (req.kind === "receivables") {
    const props = await withTenant(pool, schema, (tx) => propertiesOf(tx, req.propertyIds));
    const currency = req.currency ?? props[0]!.currency;
    checkRates(req, props, currency);
    return receivablesReport(pool, schema, req, props, currency);
  }
  return withTenant(pool, schema, async (tx) => {
    const props = await propertiesOf(tx, req.propertyIds);
    const currency = req.currency ?? props[0]!.currency;
    checkRates(req, props, currency);
    const table = await build(tx, req, props, currency);
    const comparable = COMPARABLE[req.kind];
    if (!comparable || !(req.compare.previous || req.compare.lastYear)) return table;
    const plain = { ...req, compare: { previous: false, lastYear: false } };
    const others: [ComparedWith, ReportTable][] = [];
    if (req.compare.previous) others.push(["previous", await build(tx, { ...plain, ...previousPeriod(req) }, props, currency)]);
    if (req.compare.lastYear) others.push(["lastYear", await build(tx, { ...plain, ...lastYearPeriod(req) }, props, currency)]);
    return withComparisons(table, others, comparable, req);
  });
}

type ComparedWith = "previous" | "lastYear";

/** Reports compared line by line with another period (occupancy compares per period itself): the line's key and the figures compared. */
const COMPARABLE: Partial<Record<ReportKind, { key: (cells: ReportRow["cells"]) => string; columns: string[] }>> = {
  source_mix: { key: (c) => String(c.source), columns: ["nights", "revenue"] },
  cancellations: { key: (c) => String(c.label), columns: ["cancellations", "lost", "noShows"] },
  revenue_by_code: { key: (c) => `${c.category}|${c.service}|${c.taxCode}`, columns: ["net", "gross"] },
};

/** The compared periods' figures beside each line; a line the other period lacks shows none there. */
function withComparisons(table: ReportTable, others: [ComparedWith, ReportTable][], spec: { key: (cells: ReportRow["cells"]) => string; columns: string[] }, req: ReportRequest): ReportTable {
  const columns = [...table.columns];
  for (const [suffix] of others) {
    for (const k of spec.columns) {
      const c = table.columns.find((x) => x.key === k)!;
      columns.push({ key: `${k}_${suffix}`, label: `${c.label} ${t(req, suffix)}`, kind: c.kind });
    }
  }
  const rows = table.rows.map((r) => {
    const cells = { ...r.cells };
    for (const [suffix, other] of others) {
      const match = other.rows.find((o) => spec.key(o.cells) === spec.key(r.cells));
      for (const k of spec.columns) cells[`${k}_${suffix}`] = match?.cells[k] ?? null;
    }
    return { ...r, cells };
  });
  return { ...table, columns, rows, notes: [...table.notes, t(req, "lastYearNote")] };
}

async function build(tx: PoolClient, req: ReportRequest, props: PropertyInfo[], currency: string): Promise<ReportTable> {
  switch (req.kind) {
    case "occupancy":
      return occupancyReport(tx, req, props, currency);
    case "pickup":
      return pickupReport(tx, req, props, currency);
    case "source_mix":
      return sourceMixReport(tx, req, props, currency);
    case "cancellations":
      return cancellationsReport(tx, req, props, currency);
    case "revenue_by_code":
      return revenueByCodeReport(tx, req, props, currency);
    case "housekeeping":
      return housekeepingReport(tx, req, props);
    case "cash":
      return cashReport(tx, req, props, currency);
    default:
      throw new Error("Unknown report");
  }
}

/** Log an export of a report: who, which, where, how, how many rows. */
export async function logReportExport(pool: Pool, schema: string, entry: { userId: string; kind: ReportKind; propertyIds: string[]; format: "csv" | "pdf" | "mail"; rowCount: number }): Promise<void> {
  await withTenant(pool, schema, (tx) =>
    tx.query("insert into report_exports (user_id, kind, property_ids, format, row_count) values ($1, $2, $3, $4, $5)", [entry.userId, entry.kind, entry.propertyIds, entry.format, entry.rowCount]),
  );
}
