"use server";

import { revalidatePath } from "next/cache";
import { PRICE_ACTIONS, RESTRICTION_FIELDS, addDays, isOneOf, roundMoney, type BulkEdit, type BulkPreview } from "@hoteloftware/domain";
import { applyBulkEdit, applyGridEdit, listBelowFloor, undoLastChange } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { formAction } from "@/lib/form";
import { propertyFor } from "@/lib/property-scope";

const PATH = "/rates";

export interface GridActionState {
  ok?: boolean;
  error?: string;
  /** Saved, but something needs attention, for example a price below the Price Floor. */
  warning?: string;
  /** Plain confirmation, for example after Undo. */
  notice?: string;
  preview?: BulkPreview;
}

const scoped = (propertyId: string) => propertyFor("manage_rates", propertyId);

/** Prices on that date (typed row and its followers) now below their Price Floor. */
async function floorWarning(schema: string, propertyId: string, date: string, roomTypeId: string): Promise<string | undefined> {
  const below = (await listBelowFloor(pool(), schema, propertyId, date, 500)).filter((b) => b.date === date && b.roomTypeId === roomTypeId);
  if (below.length === 0) return undefined;
  return `Below the Price Floor of ${below[0]!.priceFloor}: ${below.map((b) => `${b.ratePlanCode} ${b.price}`).join(", ")}. Saved, and listed for the Property Manager.`;
}

/** A price typed into one cell of a base row. Saved at once; below the floor it saves with a warning. */
export async function saveCell(input: { propertyId: string; ratePlanId: string; roomTypeId: string; date: string; price: number }): Promise<GridActionState> {
  return formAction(async () => {
    const { schema, property, userId } = await scoped(input.propertyId);
    if (!Number.isFinite(input.price) || input.price < 0) throw new Error("A price is zero or more");
    await applyGridEdit(pool(), schema, property.id, userId, {
      prices: [{ ratePlanId: input.ratePlanId, roomTypeId: input.roomTypeId, date: input.date, price: roundMoney(input.price) }],
      restrictions: [],
    });
    revalidatePath(PATH);
    const warning = await floorWarning(schema, property.id, input.date, input.roomTypeId);
    return { ok: true, ...(warning ? { warning } : {}) };
  });
}

function checkEdit(edit: BulkEdit): BulkEdit {
  if (!isOneOf(PRICE_ACTIONS, edit.price.action) || !Number.isFinite(edit.price.value)) throw new Error("Choose how the price changes");
  if (!Array.isArray(edit.weekdays) || edit.weekdays.length !== 7) throw new Error("Seven weekdays expected");
  if (edit.restriction && !isOneOf(RESTRICTION_FIELDS, edit.restriction.field)) throw new Error("Unknown restriction");
  if (edit.to < edit.from) throw new Error("The end date is before the start date");
  if (addDays(edit.from, 400) < edit.to) throw new Error("Select at most 400 days at once");
  return edit;
}

/** Bulk Apply: planned and written in one locked transaction; refused if the cells changed since the preview. */
export async function applyBulk(propertyId: string, edit: BulkEdit, expectedCells: number): Promise<GridActionState> {
  return formAction(async () => {
    const { schema, property, userId } = await scoped(propertyId);
    const result = await applyBulkEdit(pool(), schema, property.id, userId, checkEdit(edit), expectedCells);
    if (result.stale) return { error: "The cells changed since the preview. Check the preview again and apply.", preview: result.preview };
    revalidatePath(PATH);
    const below = result.preview.belowFloor;
    return { ok: true, preview: result.preview, ...(below ? { warning: `${below} prices are below the Price Floor. Saved, and listed for the Property Manager.` } : {}) };
  });
}

export async function undo(propertyId: string): Promise<GridActionState> {
  return formAction(async () => {
    const { schema, property, userId } = await scoped(propertyId);
    const result = await undoLastChange(pool(), schema, property.id, userId);
    revalidatePath(PATH);
    return { ok: true, notice: `Undone: ${result.cells} cells restored.` };
  });
}
