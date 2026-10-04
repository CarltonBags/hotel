"use server";

import { revalidatePath } from "next/cache";
import {
  TaskStarted,
  failInspection,
  generateHousekeepingTasks,
  listTenantUsers,
  moveHousekeepingTask,
  propertyOfRoom,
  proposeHousekeeping,
  publishHousekeeping,
  setCleanliness,
  setHousekeepingRules,
  setRoomTypeHousekeeping,
} from "@hoteloftware/db";
import type { StayoverRhythm, TaskKind } from "@hoteloftware/domain";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { formAction, type FormState } from "@/lib/form";

/** The supervisor's board (ticket 34): Housekeeping Supervisor and Property Manager of the property. */

const PATH = "/housekeeping";

async function supervisor(propertyId: string) {
  const { tenant, session, actor } = await authorize("assign_housekeeping", String(propertyId));
  return { tenant, schema: tenant.schemaName, viewer: { userId: session.user.id, actor } };
}

/** The property's Housekeepers: the people the plan may give tasks to. */
async function housekeepersOf(tenantId: string, propertyId: string): Promise<string[]> {
  return (await listTenantUsers(pool(), tenantId)).filter((u) => !u.pendingInvitation && u.propertyRoles.some((r) => r.propertyId === propertyId && r.role === "housekeeper")).map((u) => u.id);
}

export async function generateAction(propertyId: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer } = await supervisor(propertyId);
    await generateHousekeepingTasks(pool(), schema, String(propertyId), viewer);
    revalidatePath(PATH);
    return { ok: true, message: "Tasks updated." };
  });
}

export async function proposeAction(propertyId: string): Promise<FormState> {
  return formAction(async () => {
    const { tenant, schema, viewer } = await supervisor(propertyId);
    await proposeHousekeeping(pool(), schema, String(propertyId), await housekeepersOf(tenant.id, String(propertyId)), viewer);
    revalidatePath(PATH);
    return { ok: true, message: "Distribution proposed." };
  });
}

export async function publishAction(propertyId: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer } = await supervisor(propertyId);
    await publishHousekeeping(pool(), schema, String(propertyId), viewer);
    revalidatePath(PATH);
    return { ok: true, message: "Published." };
  });
}

export async function moveTaskAction(propertyId: string, taskId: string, assigneeId: string | null, confirm: boolean): Promise<FormState & { started?: boolean }> {
  let started = false;
  const state = await formAction(async () => {
    const { tenant, schema, viewer } = await supervisor(propertyId);
    if (assigneeId && !(await housekeepersOf(tenant.id, String(propertyId))).includes(String(assigneeId))) throw new Error("Not a Housekeeper of this property");
    try {
      await moveHousekeepingTask(pool(), schema, String(taskId), assigneeId ? String(assigneeId) : null, viewer, { confirm: confirm === true });
    } catch (err) {
      if (err instanceof TaskStarted) started = true;
      throw err;
    }
    revalidatePath(PATH);
    return { ok: true, message: "Moved." };
  });
  return { ...state, ...(started ? { started } : {}) };
}

async function roomScope(roomId: string) {
  const { tenant } = await requirePrincipal();
  const propertyId = await propertyOfRoom(pool(), tenant.schemaName, { roomId: String(roomId) });
  if (!propertyId) throw new Error("Room not found");
  const { session, actor } = await authorize("view_rooms", propertyId);
  return { schema: tenant.schemaName, viewer: { userId: session.user.id, actor } };
}

export async function inspectAction(roomId: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer } = await roomScope(roomId);
    await setCleanliness(pool(), schema, String(roomId), "inspected", viewer);
    revalidatePath(PATH);
    return { ok: true, message: "Inspected." };
  });
}

export async function failInspectionAction(roomId: string, reason: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer } = await roomScope(roomId);
    await failInspection(pool(), schema, String(roomId), String(reason ?? ""), viewer);
    revalidatePath(PATH);
    return { ok: true, message: "Back to Dirty; the room returns to its housekeeper." };
  });
}

export async function rulesAction(propertyId: string, input: { stayover: StayoverRhythm; linenEvery: number | null; shiftMinutes: number }): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer } = await supervisor(propertyId);
    await setHousekeepingRules(pool(), schema, String(propertyId), { stayover: input.stayover, linenEvery: input.linenEvery === null ? null : Number(input.linenEvery), shiftMinutes: Number(input.shiftMinutes) }, viewer);
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function roomTypeAction(propertyId: string, roomTypeId: string, input: { stayover: StayoverRhythm | null; linenEvery: number | null; minutes: Partial<Record<TaskKind, number>> }): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer } = await supervisor(propertyId);
    await setRoomTypeHousekeeping(pool(), schema, String(roomTypeId), input, viewer);
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}
