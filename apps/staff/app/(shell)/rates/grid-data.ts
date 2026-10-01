import { OPEN_RESTRICTION, addDays, cellKey, type GridRow, type GridState, type Restriction } from "@hoteloftware/domain";
import { listRatePlans, listRates, listRestrictions, listRoomTypes, type Property } from "@hoteloftware/db";
import { pool } from "@/lib/db";

export interface GridRowView extends GridRow {
  ratePlanCode: string;
  ratePlanName: string;
  roomTypeCode: string;
  roomTypeName: string;
}

export interface GridCell {
  price: number | null;
  /** What applies (inherited fields taken from the base for derived rows). */
  restriction: Restriction;
  /** Stored on this row; the planner writes against it. */
  own: Restriction;
}

/** Active plans by room type with prices and restrictions for a date range: what the grid shows and what the planner reads. */
export async function loadGrid(schema: string, property: Property, from: string, days: number) {
  const to = addDays(from, days - 1);
  const [plans, roomTypes, rates, restrictions] = await Promise.all([
    listRatePlans(pool(), schema, property.id),
    listRoomTypes(pool(), schema, property.id),
    listRates(pool(), schema, property.id, { from, to }),
    listRestrictions(pool(), schema, property.id, { from, to }),
  ]);
  const types = new Map(roomTypes.map((t) => [t.id, t]));
  // bases first, each followed by the plans derived from it
  const ordered = plans.filter((p) => p.kind === "base").flatMap((b) => [b, ...plans.filter((d) => d.basePlanId === b.id)]);
  const rows: GridRowView[] = ordered.flatMap((p) =>
    p.roomTypeIds
      .map((id) => types.get(id))
      .filter((t) => t !== undefined)
      .map((t) => ({
        ratePlanId: p.id,
        roomTypeId: t.id,
        basePlanId: p.basePlanId,
        derivation: p.derivation,
        inherits: p.kind === "derived" ? p.inherits : null,
        priceFloor: t.priceFloor,
        ratePlanCode: p.code,
        ratePlanName: p.name,
        roomTypeCode: t.code,
        roomTypeName: t.name,
      })),
  );
  const cells: Record<string, GridCell> = {};
  const k = cellKey;
  for (const r of rates) cells[k(r.ratePlanId, r.roomTypeId, r.date)] = { price: r.price, restriction: OPEN_RESTRICTION, own: OPEN_RESTRICTION };
  for (const r of restrictions) {
    const key = k(r.ratePlanId, r.roomTypeId, r.date);
    cells[key] = { price: cells[key]?.price ?? null, restriction: r.restriction, own: r.own };
  }
  const state = (): GridState => ({
    price: (p, r, d) => cells[k(p, r, d)]?.price ?? null,
    restriction: (p, r, d) => cells[k(p, r, d)]?.own ?? OPEN_RESTRICTION,
  });
  return { plans, rows, cells, from, to, state };
}
