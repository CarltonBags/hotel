import type { Pool } from "pg";
import { DATA_SET_COLUMNS, roundMoney, type BuilderDefinition, type DataSet, type ReportColumn, type ReportRow, type ReportTable } from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { withTenant } from "./with-tenant";

/**
 * The report builder's tables (ticket 84). Each data set has a fixed FROM,
 * the date its range applies to, and one SQL expression per column: nothing
 * from the browser reaches the SQL but bound values. The caller has checked
 * the definition against the user's rights (checkDefinition).
 */
interface Source {
  from: string;
  date: string;
  property: string;
  columns: Record<string, string>;
}

const GUEST = "trim(g.last_name || ', ' || g.first_name)";

const SOURCES: Record<DataSet, Source> = {
  room_nights: {
    from: `reservation_nights rn join reservations r on r.id = rn.reservation_id join bookings b on b.id = r.booking_id join room_types t on t.id = r.room_type_id
      join rate_plans rp on rp.id = r.rate_plan_id join guests g on g.id = r.primary_guest_id`,
    date: "rn.date",
    property: "r.property_id",
    columns: { date: "to_char(rn.date, 'YYYY-MM-DD')", confirmation: "b.confirmation_number", status: "r.status", room_type: "t.name", rate_plan: "rp.name", source: "b.source", guest: GUEST, country: "coalesce(g.country_of_residence, '')", price: "rn.total", nights: "1" },
  },
  reservations: {
    from: `reservations r join bookings b on b.id = r.booking_id join room_types t on t.id = r.room_type_id join rate_plans rp on rp.id = r.rate_plan_id join guests g on g.id = r.primary_guest_id`,
    date: "r.arrival",
    property: "r.property_id",
    columns: {
      confirmation: "b.confirmation_number",
      status: "r.status",
      arrival: "to_char(r.arrival, 'YYYY-MM-DD')",
      departure: "to_char(r.departure, 'YYYY-MM-DD')",
      room_type: "t.name",
      rate_plan: "rp.name",
      source: "b.source",
      channel: "coalesce(b.channel_name, '')",
      guest: GUEST,
      email: "coalesce(g.email, '')",
      phone: "coalesce(g.phone, '')",
      country: "coalesce(g.country_of_residence, '')",
      adults: "r.adults",
      nights: "(r.departure - r.arrival)",
      total: "(select coalesce(sum(n.total), 0) from reservation_nights n where n.reservation_id = r.id)",
      count: "1",
    },
  },
  charges: {
    from: `charges c join tax_codes tc on tc.id = c.tax_code_id left join services s on s.id = c.service_id left join reservations r on r.id = c.reservation_id
      left join bookings b on b.id = r.booking_id left join guests g on g.id = r.primary_guest_id`,
    date: "c.service_date",
    property: "c.property_id",
    columns: {
      service_date: "to_char(c.service_date, 'YYYY-MM-DD')",
      business_date: "to_char(c.business_date, 'YYYY-MM-DD')",
      category: "c.category",
      service: "coalesce(s.name, c.description)",
      tax_code: "tc.code",
      confirmation: "coalesce(b.confirmation_number, '')",
      guest: `coalesce(${GUEST}, '')`,
      net: "round(c.amount / (1 + c.tax_rate / 100), 2)",
      gross: "c.amount",
      count: "1",
    },
  },
  payments: {
    from: `payments p left join reservations r on r.id = p.reservation_id left join bookings b on b.id = r.booking_id left join guests g on g.id = r.primary_guest_id`,
    date: "p.business_date",
    property: "p.property_id",
    columns: { business_date: "to_char(p.business_date, 'YYYY-MM-DD')", tender: "p.tender", status: "p.status", confirmation: "coalesce(b.confirmation_number, '')", guest: `coalesce(${GUEST}, '')`, reference: "coalesce(p.reference, '')", amount: "p.amount", count: "1" },
  },
  housekeeping_tasks: {
    from: `housekeeping_tasks h join rooms m on m.id = h.room_id left join control."user" u on u.id = h.assignee_id`,
    date: "h.business_date",
    property: "h.property_id",
    columns: { business_date: "to_char(h.business_date, 'YYYY-MM-DD')", room: "m.number", kind: "h.kind", status: "h.status", assignee: "coalesce(u.name, '')", minutes: "coalesce(h.minutes, 0)", count: "1" },
  },
};

// voided Charges are no revenue
const ALWAYS: Partial<Record<DataSet, string>> = { charges: "c.voided_at is null" };

/** At most this many lines without grouping; more is a raw export's job. */
export const BUILDER_ROW_LIMIT = 5000;

/** A raw data export: lines without grouping, up to this many. */
export const RAW_ROW_LIMIT = 100_000;

export async function runBuilder(pool: Pool, schema: string, def: BuilderDefinition, scope: { propertyIds: string[]; from: string; to: string; language: "en" | "de"; limit?: number }): Promise<ReportTable & { truncated: boolean }> {
  const limit = Math.min(scope.limit ?? BUILDER_ROW_LIMIT, RAW_ROW_LIMIT);
  if (!scope.propertyIds.length || !scope.propertyIds.every(isUuid)) throw new Error("Choose a property");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scope.from) || !/^\d{4}-\d{2}-\d{2}$/.test(scope.to) || scope.to < scope.from) throw new Error("Choose a date range");
  const src = SOURCES[def.dataSet];
  const meta = new Map(DATA_SET_COLUMNS[def.dataSet].map((c) => [c.key, c]));
  const expr = (k: string) => {
    const e = src.columns[k];
    if (!e) throw new Error(`Unknown column ${k}`);
    return e;
  };
  const args: unknown[] = [scope.from, scope.to, scope.propertyIds];
  const where = [`${src.date} between $1 and $2`, `${src.property} = any($3::uuid[])`, ...(ALWAYS[def.dataSet] ? [ALWAYS[def.dataSet]!] : [])];
  for (const f of def.filters) {
    args.push(f.op === "contains" ? `%${f.value.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : f.value);
    where.push(`(${expr(f.column)})::text ${f.op === "eq" ? "=" : f.op === "neq" ? "<>" : "ilike"} $${args.length}`);
  }
  const grouped = def.groupBy.length > 0;
  const select = def.columns.map((k, i) => (grouped && !meta.get(k)!.groupable ? `sum(${expr(k)}) as c${i}` : `${expr(k)} as c${i}`));
  const sql = `select ${select.join(", ")} from ${src.from} where ${where.join(" and ")}
    ${grouped ? `group by ${def.groupBy.map((g) => `c${def.columns.indexOf(g)}`).join(", ")} order by ${def.groupBy.map((g) => `c${def.columns.indexOf(g)}`).join(", ")}` : `order by ${src.date}, 1 limit ${limit + 1}`}`;
  const rows = await withTenant(pool, schema, async (tx) => (await tx.query<Record<string, unknown>>(sql, args)).rows);
  const truncated = !grouped && rows.length > limit;
  const columns: ReportColumn[] = def.columns.map((k) => ({ key: k, label: meta.get(k)!.label[scope.language], kind: meta.get(k)!.kind }));
  const value = (k: string, v: unknown) => (v === null || v === undefined ? null : meta.get(k)!.kind === "text" ? String(v) : Number(v));
  const out: ReportRow[] = rows.slice(0, limit).map((r) => ({ cells: Object.fromEntries(def.columns.map((k, i) => [k, value(k, r[`c${i}`])])) }));
  if (def.totals) {
    out.push({
      cells: Object.fromEntries(def.columns.map((k, i) => [k, meta.get(k)!.kind === "text" ? (i === 0 ? (scope.language === "de" ? "Gesamt" : "Total") : "") : roundMoney(out.reduce((s, r) => s + Number(r.cells[k] ?? 0), 0))])),
      emphasis: true,
      ref: "total",
    });
  }
  return { title: "", notes: [`${scope.from} – ${scope.to}`], columns, rows: out, truncated };
}

// ── saved reports ──

export interface SavedReport {
  id: string;
  ownerId: string;
  propertyId: string;
  name: string;
  definition: BuilderDefinition;
  shared: boolean;
}

/** Save a report: private, or shared with the property's users who may see its data set. */
export async function saveReport(pool: Pool, schema: string, input: { id?: string; ownerId: string; propertyId: string; name: string; definition: BuilderDefinition; shared: boolean }): Promise<string> {
  if (!isUuid(input.propertyId)) throw new Error("Choose a property");
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("Name the report");
  return withTenant(pool, schema, async (tx) => {
    if (input.id) {
      if (!isUuid(input.id)) throw new Error("Report not found");
      const n = (await tx.query("update saved_reports set name = $3, definition = $4, shared = $5, property_id = $6, updated_at = now() where id = $1 and owner_id = $2", [input.id, input.ownerId, name, JSON.stringify(input.definition), input.shared, input.propertyId])).rowCount;
      if (!n) throw new Error("Only its owner changes a saved report");
      return input.id;
    }
    const { rows } = await tx.query<{ id: string }>("insert into saved_reports (owner_id, property_id, name, definition, shared) values ($1, $2, $3, $4, $5) returning id", [input.ownerId, input.propertyId, name, JSON.stringify(input.definition), input.shared]);
    return rows[0]!.id;
  });
}

/** One's own reports, and those shared at the properties given (the caller passes where the user may see each data set). */
export async function listSavedReports(pool: Pool, schema: string, userId: string, sharedAt: (r: SavedReport) => boolean): Promise<SavedReport[]> {
  const rows = await withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; owner_id: string; property_id: string; name: string; definition: BuilderDefinition; shared: boolean }>(
      "select id, owner_id, property_id, name, definition, shared from saved_reports where owner_id = $1 or shared order by name",
      [userId],
    )).rows,
  );
  return rows.map((r) => ({ id: r.id, ownerId: r.owner_id, propertyId: r.property_id, name: r.name, definition: r.definition, shared: r.shared })).filter((r) => r.ownerId === userId || sharedAt(r));
}

export async function deleteSavedReport(pool: Pool, schema: string, id: string, userId: string): Promise<void> {
  if (!isUuid(id)) throw new Error("Report not found");
  const n = await withTenant(pool, schema, async (tx) => (await tx.query("delete from saved_reports where id = $1 and owner_id = $2", [id, userId])).rowCount);
  if (!n) throw new Error("Only its owner deletes a saved report");
}
