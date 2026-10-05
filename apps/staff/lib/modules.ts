import { findProperty, modulePeriods } from "@hoteloftware/db";
import { moduleState, moduleVisible, todayIn, type Module } from "@hoteloftware/domain";
import { pool } from "./db";

/** A Module of the subscription is on (or readable) at the property today. Server only. */
export async function moduleOn(schema: string, propertyId: string, module: Module): Promise<boolean> {
  const p = await findProperty(pool(), schema, propertyId);
  if (!p) return false;
  const periods = await modulePeriods(pool(), schema, [propertyId]);
  return moduleVisible(moduleState(periods.get(propertyId) ?? [], module, todayIn(p.timeZone)));
}
