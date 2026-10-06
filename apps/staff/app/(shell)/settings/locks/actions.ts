"use server";

import { revalidatePath } from "next/cache";
import { saveLockSettings, setDeskEncoder, setLockDoor } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";
import { lockDeps } from "@/lib/locks";

/** The property's lock system, key handover, doors and desk encoders (ticket 67): the Property Manager. */
const PATH = "/settings/locks";
const viewerOf = (p: Awaited<ReturnType<typeof authorize>>) => ({ userId: p.session.user.id, actor: p.actor });

export async function lockSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const p = await authorize("manage_property_settings", propertyId);
    await saveLockSettings(
      pool(),
      p.tenant.schemaName,
      propertyId,
      { system: field(formData, "system"), otherName: field(formData, "otherName"), handover: field(formData, "handover"), graceMinutes: Number(field(formData, "graceMinutes")), secret: field(formData, "secret") || null },
      viewerOf(p),
      lockDeps(),
    );
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function lockDoorsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const p = await authorize("manage_property_settings", field(formData, "propertyId"));
    for (const [k, v] of formData.entries()) if (k.startsWith("door_") && typeof v === "string") await setLockDoor(pool(), p.tenant.schemaName, k.slice(5), v, viewerOf(p));
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function deskEncodersAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const p = await authorize("manage_property_settings", propertyId);
    for (const [k, v] of formData.entries()) if (k.startsWith("device_") && typeof v === "string") await setDeskEncoder(pool(), p.tenant.schemaName, propertyId, k.slice(7), v, viewerOf(p));
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}
