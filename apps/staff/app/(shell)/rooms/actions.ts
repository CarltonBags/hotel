"use server";

import { revalidatePath } from "next/cache";
import { assignHousekeeping, createRoomBlock, endRoomBlock, propertyOfRoom, setCleanliness, setInspectionRequired } from "@hoteloftware/db";
import type { Cleanliness, RoomBlockKind } from "@hoteloftware/domain";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { formAction, type FormState } from "@/lib/form";

/** Room state (ticket 33): rights are checked at the room's own property (and the front office's working property); the database checks the matrix. */

async function scope(ref: { roomId?: string; blockId?: string }) {
  const { tenant } = await requirePrincipal();
  const propertyId = await propertyOfRoom(pool(), tenant.schemaName, ref);
  if (!propertyId) throw new Error("Room not found");
  const { session, actor } = await authorize("view_rooms", propertyId);
  return { schema: tenant.schemaName, propertyId, viewer: { userId: session.user.id, actor } };
}

export async function setCleanlinessAction(roomId: string, to: Cleanliness): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer } = await scope({ roomId: String(roomId) });
    await setCleanliness(pool(), schema, String(roomId), to, viewer);
    revalidatePath("/rooms");
    return { ok: true, message: "Saved." };
  });
}

export async function createBlockAction(input: { roomId: string; kind: RoomBlockKind; from: string; to: string; reason: string }): Promise<FormState & { conflicts?: string[] }> {
  let conflicts: string[] | undefined;
  const state = await formAction(async () => {
    const { schema, viewer } = await scope({ roomId: String(input.roomId) });
    const r = await createRoomBlock(pool(), schema, { roomId: String(input.roomId), kind: input.kind, from: String(input.from), to: String(input.to), reason: String(input.reason ?? "") }, viewer);
    conflicts = r.conflicts.map((c) => `${c.confirmationNumber} ${c.guestName} (${c.from} – ${c.to})`);
    revalidatePath("/rooms");
    return { ok: true, message: conflicts.length ? `Blocked. Move these stays: ${conflicts.join("; ")}` : "Blocked." };
  });
  return { ...state, ...(conflicts?.length ? { conflicts } : {}) };
}

export async function endBlockAction(blockId: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer } = await scope({ blockId: String(blockId) });
    await endRoomBlock(pool(), schema, String(blockId), viewer);
    revalidatePath("/rooms");
    return { ok: true, message: "Block ended." };
  });
}

export async function assignHousekeepingAction(roomId: string, assigneeId: string | null): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer } = await scope({ roomId: String(roomId) });
    await assignHousekeeping(pool(), schema, String(roomId), assigneeId ? String(assigneeId) : null, viewer);
    revalidatePath("/rooms");
    return { ok: true, message: "Saved." };
  });
}

export async function inspectionAction(propertyId: string, required: boolean): Promise<FormState> {
  return formAction(async () => {
    const { tenant } = await authorize("manage_property_settings", String(propertyId));
    await setInspectionRequired(pool(), tenant.schemaName, String(propertyId), required === true);
    revalidatePath("/rooms");
    return { ok: true, message: "Saved." };
  });
}
