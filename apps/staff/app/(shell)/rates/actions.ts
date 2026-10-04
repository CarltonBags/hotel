"use server";

import { revalidatePath } from "next/cache";
import { PRICE_ACTIONS, RESTRICTION_FIELDS, addDays, isOneOf, roundMoney, type BulkEdit, type BulkPreview } from "@hoteloftware/domain";
import { applyBulkEdit, applyGridEdit, applyRatesTool, createEventMarker, deleteEventMarker, listBelowFloor, undoLastChange, type RatesTool } from "@hoteloftware/db";
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

export interface ToolState extends GridActionState {
  /** What the tool changes, computed on the server from the stored prices. */
  toolPreview?: { cells: number; rows: number; belowFloor: number; skipped: number; skippedRows: { ratePlanId: string; roomTypeId: string }[] };
}

function checkTool(tool: RatesTool): RatesTool {
  if (!["paste", "copy", "fill"].includes(tool?.kind)) throw new Error("Unknown tool");
  // a fill takes every row whose prices end; paste and copy the rows in view
  if (!Array.isArray(tool.rows) || tool.rows.length === 0 || tool.rows.length > (tool.kind === "fill" ? 2000 : 200)) throw new Error("Select the rows first");
  if (tool.kind === "paste" && (!Array.isArray(tool.block) || tool.block.length === 0 || tool.block.length > 200 || tool.block.some((r) => !Array.isArray(r) || r.length > 400))) throw new Error("Paste at most 200 rows by 400 days");
  if (tool.kind === "fill" && tool.mode.kind !== "repeat_week" && tool.mode.kind !== "base") throw new Error("Choose how to fill");
  return tool;
}

/** Paste, copy period or fill to the horizon: preview without expected cells, apply with them. */
export async function runTool(propertyId: string, tool: RatesTool, expectedCells: number | null): Promise<ToolState> {
  return formAction(async () => {
    const { schema, property, userId } = await scoped(propertyId);
    const r = await applyRatesTool(pool(), schema, property.id, userId, checkTool(tool), expectedCells);
    const toolPreview = { ...r.preview, skipped: r.skipped, skippedRows: r.skippedRows };
    if (expectedCells === null) return { ok: true, toolPreview };
    if (r.stale) return { error: "The prices changed since the preview. Check the new preview and apply.", toolPreview };
    revalidatePath(PATH);
    return { ok: true, toolPreview, ...(r.preview.belowFloor ? { warning: `${r.preview.belowFloor} prices are below the Price Floor. Saved, and listed for the Property Manager.` } : { notice: `Saved: ${r.preview.cells} cells. Undo reverts it.` }) };
  });
}

export async function addEventMarker(propertyId: string, input: { name: string; from: string; to: string }): Promise<GridActionState> {
  return formAction(async () => {
    const { schema, property, userId } = await scoped(propertyId);
    await createEventMarker(pool(), schema, property.id, userId, input);
    revalidatePath(PATH);
    return { ok: true, notice: "Event Marker saved." };
  });
}

export async function removeEventMarker(propertyId: string, id: string): Promise<GridActionState> {
  return formAction(async () => {
    const { schema, property } = await scoped(propertyId);
    await deleteEventMarker(pool(), schema, property.id, id);
    revalidatePath(PATH);
    return { ok: true, notice: "Event Marker removed." };
  });
}
