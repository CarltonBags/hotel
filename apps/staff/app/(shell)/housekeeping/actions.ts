"use server";

import { revalidatePath } from "next/cache";
import {
  TaskStarted,
  createSection,
  failInspection,
  generateHousekeepingTasks,
  moveHousekeepingTask,
  propertyOfRoom,
  propertyOfTask,
  updateRoom,
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
import { housekeepersAt } from "@/lib/housekeepers";

/** The supervisor's board (ticket 34): Housekeeping Supervisor and Property Manager of the property. */

const PATH = "/housekeeping";

async function supervisor(propertyId: string) {
  const { tenant, session, actor } = await authorize("assign_housekeeping", String(propertyId));
  return { tenant, schema: tenant.schemaName, viewer: { userId: session.user.id, actor } };
}

const housekeepersOf = async (tenantId: string, propertyId: string) => (await housekeepersAt(tenantId, propertyId)).map((h) => h.id);

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

/** Move a room's tasks (the room of the task given) to a housekeeper of the task's own property. */
export async function moveTaskAction(taskId: string, assigneeId: string | null, confirm: boolean): Promise<FormState & { started?: boolean }> {
  let started = false;
  const state = await formAction(async () => {
    const { tenant: t } = await requirePrincipal();
    const propertyId = await propertyOfTask(pool(), t.schemaName, String(taskId));
    if (!propertyId) throw new Error("Task not found");
    const { tenant, schema, viewer } = await supervisor(propertyId);
    if (assigneeId && !(await housekeepersOf(tenant.id, propertyId)).includes(String(assigneeId))) throw new Error("Not a Housekeeper of this property");
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

/** Sections (Reviere) are kept by the Housekeeping Supervisor too (matrix "Generate, assign, publish Housekeeping Tasks; Sections"). */
export async function createSectionAction(propertyId: string, name: string): Promise<FormState> {
  return formAction(async () => {
    const { schema } = await supervisor(propertyId);
    await createSection(pool(), schema, { propertyId: String(propertyId), name: String(name ?? "") });
    revalidatePath(PATH);
    return { ok: true, message: "Section added." };
  });
}

export async function roomSectionAction(propertyId: string, roomId: string, sectionId: string | null): Promise<FormState> {
  return formAction(async () => {
    const { schema } = await supervisor(propertyId);
    await updateRoom(pool(), schema, String(propertyId), String(roomId), { sectionId: sectionId ? String(sectionId) : null });
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}
