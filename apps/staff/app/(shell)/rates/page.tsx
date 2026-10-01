import { addDays, can, todayIn } from "@hoteloftware/domain";
import { listBelowFloor, listPriceEnds, listRateChanges, listTenantUsers } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { loadGrid } from "./grid-data";
import { RatesGrid } from "./rates-grid";

function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Prices are kept at least this many days ahead ("Rates and restrictions model"). */
const HORIZON_DAYS = 500;
const VISIBLE_DAYS = 28;

/** The Rates grid of the property selected in the navbar. */
export default async function RatesPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    const manageable = shell.properties.filter((p) => can(shell.principal.actor, "manage_rates", p.id));
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.rates"]}</h1>
        <p className="mt-2 text-ink-60">{m["grid.pickProperty"]}</p>
        {manageable.length === 0 ? <p className="mt-2 text-ink-60">{m["rates.noneManaged"]}</p> : null}
      </div>
    );
  }
  const { tenant } = await requireAllowed("manage_rates", property.id);
  const schema = tenant.schemaName;
  // The open Business Date arrives with Night Audit; until then the property's own today stands in.
  const today = todayIn(property.timeZone);
  const requested = (await searchParams).from;
  const from = requested && isCalendarDate(requested) ? requested : addDays(today, -3);
  const [grid, below, ends, changes, users] = await Promise.all([
    loadGrid(schema, property, from, VISIBLE_DAYS),
    listBelowFloor(pool(), schema, property.id, today),
    listPriceEnds(pool(), schema, property.id, addDays(today, HORIZON_DAYS)),
    listRateChanges(pool(), schema, property.id, { limit: 300 }),
    listTenantUsers(pool(), tenant.id),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  return (
    <RatesGrid
      property={{ id: property.id, name: property.name, currency: property.currency, country: property.country, timeZone: property.timeZone }}
      today={today}
      from={from}
      days={VISIBLE_DAYS}
      rows={grid.rows}
      cells={grid.cells}
      plans={grid.plans.map((p) => ({ id: p.id, code: p.code, name: p.name, basePlanId: p.basePlanId, basePlanName: grid.plans.find((b) => b.id === p.basePlanId)?.name ?? null, derivation: p.derivation }))}
      belowFloor={below}
      priceEnds={ends}
      changes={changes.map((c) => ({ ...c, at: c.at.toISOString(), userName: names.get(c.userId) ?? c.userId }))}
      language={shell.language}
      m={m}
    />
  );
}
