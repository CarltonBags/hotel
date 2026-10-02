"use server";

import { revalidatePath } from "next/cache";
import { todayIn, type AssignmentSegment } from "@hoteloftware/domain";
import { assignRoom, changeStayIntoRoom, findProperty, findReservation, moveRoom, OverbookingNeeded, previewReservationChange, restoreAssignments, type ChangePreview } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { formAction, type FormState } from "@/lib/form";
import { reservationScope } from "@/lib/reservation-scope";

/** A drop to other nights or another room type. */
export interface StayMove {
  arrival: string;
  departure: string;
  roomTypeId: string;
}

export interface DropResult extends FormState {
  /** For the 10-second Undo: the assignments before the drop and those it produced. */
  undo?: { reservationId: string; segments: AssignmentSegment[]; current: AssignmentSegment[] };
}

/** Same type, same nights: another room at once, or the first room for an unassigned stay. */
export async function dropOnRoom(reservationId: string, roomId: string, fromNight: string | null): Promise<DropResult> {
  let undo: DropResult["undo"];
  const state = await formAction(async () => {
    const { schema, reservation, userId } = await reservationScope(reservationId);
    const before = reservation.assignments.map((a) => ({ roomId: a.roomId, from: a.from, to: a.to }));
    if (fromNight && before.length) {
      let from = String(fromNight);
      if (reservation.status === "checked_in") {
        // an in-house guest keeps the nights already slept: the move starts today at the earliest
        // TODO(Night Audit ticket): Business Date instead of the property's wall-clock date
        const today = todayIn((await findProperty(pool(), schema, reservation.propertyId))!.timeZone);
        const segment = before.find((s) => s.from === from);
        if (segment && segment.to <= today) throw new Error("Nights already slept keep their room");
        if (from < today) from = today;
      }
      await moveRoom(pool(), schema, reservation.id, userId, String(roomId), from);
    } else await assignRoom(pool(), schema, reservation.id, userId, String(roomId));
    const now = await findReservation(pool(), schema, reservation.id);
    undo = { reservationId: reservation.id, segments: before, current: (now?.assignments ?? []).map((a) => ({ roomId: a.roomId, from: a.from, to: a.to })) };
    revalidatePath("/calendar");
  });
  return { ...state, ...(undo ? { ok: true, undo } : {}) };
}

export async function undoDrop(reservationId: string, segments: AssignmentSegment[], current: AssignmentSegment[]): Promise<FormState> {
  return formAction(async () => {
    const { schema, reservation, userId } = await reservationScope(reservationId);
    await restoreAssignments(pool(), schema, reservation.id, userId, Array.isArray(segments) ? segments : [], Array.isArray(current) ? current : []);
    revalidatePath("/calendar");
    return { ok: true };
  });
}

/** Old and new dates and the price difference of a drop to other nights or another room type. */
export async function previewDrop(reservationId: string, change: StayMove): Promise<{ preview: ChangePreview } | { error: string }> {
  let preview: ChangePreview | undefined;
  const state = await formAction(async () => {
    const { schema, reservation } = await reservationScope(reservationId);
    preview = await previewReservationChange(pool(), schema, reservation.id, { arrival: String(change?.arrival), departure: String(change?.departure), roomTypeId: String(change?.roomTypeId) });
  });
  return preview ? { preview } : { error: state.error ?? "Something went wrong." };
}

/** After the confirmation: change the stay in place, then put it in the dropped room. */
export async function applyDrop(reservationId: string, change: StayMove, roomId: string, expectedTotal: number): Promise<FormState> {
  return formAction(async () => {
    const { schema, reservation, userId } = await reservationScope(reservationId);
    try {
      await changeStayIntoRoom(pool(), schema, reservation.id, userId, { arrival: String(change?.arrival), departure: String(change?.departure), roomTypeId: String(change?.roomTypeId) }, String(roomId), Number(expectedTotal));
    } catch (err) {
      if (err instanceof OverbookingNeeded) throw new Error("No free room of that type on the new nights. Open the reservation to overbook.");
      throw err;
    }
    revalidatePath("/calendar");
    return { ok: true, message: "Saved." };
  });
}
