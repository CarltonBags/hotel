import type { Pool, PoolClient } from "pg";
import { BUDGET_VERSIONS, LAST_YEAR_SHIFT, addDays, daysOfMonth, spreadMonth, weekdayWeights, type BudgetDay, type BudgetMonth, type BudgetVersion } from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { nightsOf, perDate } from "./nights";
import { withTenant } from "./with-tenant";

/**
 * Budget and Forecast (ticket 83): one Budget per property and year, one
 * revised Forecast beside it; entered or imported by month, spread over the
 * days by last year's weekday pattern when a report compares with them.
 */

function checkMonths(months: BudgetMonth[]): void {
  const seen = new Set<number>();
  for (const m of months) {
    if (!Number.isInteger(m.month) || m.month < 1 || m.month > 12 || seen.has(m.month)) throw new Error("Each month once, 1 to 12");
    seen.add(m.month);
    if (!(m.occupancy >= 0 && m.occupancy <= 100)) throw new Error(`Month ${m.month}: occupancy between 0 and 100`);
    if (!(m.adr >= 0) || !(m.netRoomRevenue >= 0) || !(m.totalRevenue >= m.netRoomRevenue)) throw new Error(`Month ${m.month}: figures not negative, total revenue at least Net Room Revenue`);
  }
}

/** Enter (or replace) a property's Budget or Forecast for a year: the months given, the months to clear; others stay as they were. */
export async function setBudget(pool: Pool, schema: string, propertyId: string, input: { year: number; version: BudgetVersion; months: BudgetMonth[]; clear?: number[] }, userId: string): Promise<void> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  if (!BUDGET_VERSIONS.includes(input.version)) throw new Error("Budget or Forecast");
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) throw new Error("Choose a year");
  checkMonths(input.months);
  await withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into budgets (property_id, year, version, updated_by) values ($1, $2, $3, $4)
       on conflict (property_id, year, version) do update set updated_at = now(), updated_by = excluded.updated_by returning id`,
      [propertyId, input.year, input.version, userId],
    );
    if (input.clear?.length) await tx.query("delete from budget_months where budget_id = $1 and month = any($2::int[])", [rows[0]!.id, input.clear]);
    for (const m of input.months) {
      await tx.query(
        `insert into budget_months (budget_id, month, occupancy, adr, net_room_revenue, total_revenue) values ($1, $2, $3, $4, $5, $6)
         on conflict (budget_id, month) do update set occupancy = excluded.occupancy, adr = excluded.adr, net_room_revenue = excluded.net_room_revenue, total_revenue = excluded.total_revenue`,
        [rows[0]!.id, m.month, m.occupancy, m.adr, m.netRoomRevenue, m.totalRevenue],
      );
    }
  });
}

export async function getBudget(pool: Pool, schema: string, propertyId: string, year: number, version: BudgetVersion): Promise<{ months: BudgetMonth[]; updatedAt: Date | null; updatedBy: string | null }> {
  if (!isUuid(propertyId)) return { months: [], updatedAt: null, updatedBy: null };
  return withTenant(pool, schema, (tx) => budgetIn(tx, propertyId, year, version));
}

async function budgetIn(tx: PoolClient, propertyId: string, year: number, version: BudgetVersion): Promise<{ months: BudgetMonth[]; updatedAt: Date | null; updatedBy: string | null }> {
  const b = (await tx.query<{ id: string; updated_at: Date; updated_by: string }>("select id, updated_at, updated_by from budgets where property_id = $1 and year = $2 and version = $3", [propertyId, year, version])).rows[0];
  if (!b) return { months: [], updatedAt: null, updatedBy: null };
  const months = (await tx.query<{ month: number; occupancy: string; adr: string; net_room_revenue: string; total_revenue: string }>("select month, occupancy, adr, net_room_revenue, total_revenue from budget_months where budget_id = $1 order by month", [b.id])).rows;
  return {
    months: months.map((m) => ({ month: m.month, occupancy: Number(m.occupancy), adr: Number(m.adr), netRoomRevenue: Number(m.net_room_revenue), totalRevenue: Number(m.total_revenue) })),
    updatedAt: b.updated_at,
    updatedBy: b.updated_by,
  };
}

/**
 * The Budget and Forecast of the days from..to, spread from their months:
 * room nights from occupancy × Available Rooms, all three by last year's
 * weekday pattern of Net Room Revenue (of room nights where it had none) and
 * the day's Available Rooms. Months without figures give no days. Two night
 * queries for the whole span, shared by both versions.
 */
export async function budgetDaysIn(tx: PoolClient, propertyId: string, versions: readonly BudgetVersion[], range: { from: string; to: string }): Promise<Record<BudgetVersion, BudgetDay[]>> {
  const out: Record<BudgetVersion, BudgetDay[]> = { budget: [], forecast: [] };
  if (!versions.length) return out;
  const spanFrom = `${range.from.slice(0, 7)}-01`;
  const lastMonth = daysOfMonth(Number(range.to.slice(0, 4)), Number(range.to.slice(5, 7)));
  const spanTo = lastMonth.at(-1)!;
  const actual = new Map(perDate(await nightsOf(tx, propertyId, { from: spanFrom, to: spanTo }, null)).map((n) => [n.date, n]));
  const lastYear = perDate(await nightsOf(tx, propertyId, { from: addDays(spanFrom, -LAST_YEAR_SHIFT), to: addDays(spanTo, -LAST_YEAR_SHIFT) }, null));
  const plans = new Map<string, BudgetMonth[]>();
  for (let cursor = spanFrom; cursor <= spanTo; ) {
    const year = Number(cursor.slice(0, 4));
    const month = Number(cursor.slice(5, 7));
    const days = daysOfMonth(year, month);
    // last year's same weeks: the days 364 back from this month's
    const ly = lastYear.filter((n) => n.date >= addDays(days[0]!, -LAST_YEAR_SHIFT) && n.date <= addDays(days.at(-1)!, -LAST_YEAR_SHIFT));
    const byRevenue = ly.some((n) => n.netRoomRevenue > 0);
    const weights = weekdayWeights(ly.map((n) => ({ date: n.date, value: byRevenue ? n.netRoomRevenue : n.occupied })));
    const available = Object.fromEntries(days.map((d) => [d, actual.get(d)?.available ?? 0]));
    for (const version of versions) {
      const key = `${year}:${version}`;
      if (!plans.has(key)) plans.set(key, (await budgetIn(tx, propertyId, year, version)).months);
      const m = plans.get(key)!.find((x) => x.month === month);
      if (m) for (const d of spreadMonth(year, m, available, weights)) if (d.date >= range.from && d.date <= range.to) out[version].push(d);
    }
    cursor = addDays(days.at(-1)!, 1);
  }
  return out;
}
