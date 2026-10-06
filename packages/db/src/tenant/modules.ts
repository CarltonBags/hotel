import type { Pool } from "pg";
import { MODULE_CHECKLIST, isModule, monthEnd, moduleState, type Module, type ModulePeriod, type ModuleState } from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { withTenant } from "./with-tenant";

/**
 * Modules per property (ticket 88): switched on at once, off at the month's
 * end with their data still readable; a Module needing setup carries its
 * checklist.
 */
export interface PropertyModule {
  module: Module;
  state: ModuleState;
  onSince: string | null;
  offAt: string | null;
  checklist: { step: string; done: boolean }[];
}

export async function modulePeriods(pool: Pool, schema: string, propertyIds: string[]): Promise<Map<string, ModulePeriod[]>> {
  const valid = propertyIds.filter(isUuid);
  const rows = valid.length
    ? await withTenant(pool, schema, async (tx) =>
        (await tx.query<{ property_id: string; module: Module; on_since: string; off_at: string | null }>(
          "select property_id, module, to_char(on_since, 'YYYY-MM-DD') as on_since, to_char(off_at, 'YYYY-MM-DD') as off_at from property_modules where property_id = any($1::uuid[]) order by on_since",
          [valid],
        )).rows,
      )
    : [];
  const out = new Map<string, ModulePeriod[]>(valid.map((id) => [id, []]));
  for (const r of rows) out.get(r.property_id)!.push({ module: r.module, onSince: r.on_since, offAt: r.off_at });
  return out;
}

/** Every Module of a property: its state today, and the checklist of the running period. */
export async function propertyModules(pool: Pool, schema: string, propertyId: string, today: string): Promise<PropertyModule[]> {
  if (!isUuid(propertyId)) return [];
  const rows = await withTenant(pool, schema, async (tx) =>
    (await tx.query<{ module: Module; on_since: string; off_at: string | null; checklist: Record<string, boolean> }>(
      "select module, to_char(on_since, 'YYYY-MM-DD') as on_since, to_char(off_at, 'YYYY-MM-DD') as off_at, checklist from property_modules where property_id = $1 order by on_since",
      [propertyId],
    )).rows,
  );
  const periods = rows.map((r) => ({ module: r.module, onSince: r.on_since, offAt: r.off_at }));
  return (Object.keys(MODULE_CHECKLIST) as Module[]).map((module) => {
    const last = rows.filter((r) => r.module === module).at(-1);
    return {
      module,
      state: moduleState(periods, module, today),
      onSince: last?.on_since ?? null,
      offAt: last?.off_at ?? null,
      checklist: MODULE_CHECKLIST[module].map((step) => ({ step, done: last?.checklist?.[step] === true })),
    };
  });
}

/** Switch a Module on at a property, effective at once (billed from the next month). */
export async function switchModuleOn(pool: Pool, schema: string, propertyId: string, module: string, userId: string, today: string): Promise<void> {
  if (!isUuid(propertyId) || !isModule(module)) throw new Error("Unknown Module");
  await withTenant(pool, schema, async (tx) => {
    const running = (await tx.query<{ id: string; off_at: string | null }>("select id, to_char(off_at, 'YYYY-MM-DD') as off_at from property_modules where property_id = $1 and module = $2 order by on_since desc limit 1", [propertyId, module])).rows[0];
    // switched off this month and on again: it simply keeps running
    if (running && (running.off_at === null || running.off_at >= today)) {
      if (running.off_at !== null) await tx.query("update property_modules set off_at = null, switched_off_by = null where id = $1", [running.id]);
      return;
    }
    await tx.query("insert into property_modules (property_id, module, on_since, switched_on_by) values ($1, $2, $3, $4)", [propertyId, module, today, userId]);
  });
}

/** Switch a Module off: it runs to the end of the month; its data stays readable after. */
export async function switchModuleOff(pool: Pool, schema: string, propertyId: string, module: string, userId: string, today: string): Promise<void> {
  if (!isUuid(propertyId) || !isModule(module)) throw new Error("Unknown Module");
  const n = await withTenant(pool, schema, async (tx) => (await tx.query("update property_modules set off_at = $3, switched_off_by = $4 where property_id = $1 and module = $2 and off_at is null", [propertyId, module, monthEnd(today), userId])).rowCount);
  if (!n) throw new Error("This Module is not on");
}

export async function setModuleStep(pool: Pool, schema: string, propertyId: string, module: string, step: string, done: boolean): Promise<void> {
  if (!isUuid(propertyId) || !isModule(module) || !MODULE_CHECKLIST[module].includes(step)) throw new Error("Unknown step");
  await withTenant(pool, schema, (tx) => tx.query("update property_modules set checklist = checklist || jsonb_build_object($3::text, $4::boolean) where property_id = $1 and module = $2 and off_at is null", [propertyId, module, step, done]));
}
