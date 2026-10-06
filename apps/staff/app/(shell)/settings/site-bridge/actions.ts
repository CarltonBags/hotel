"use server";

import { revalidatePath } from "next/cache";
import { enrollSiteBridge, pushBridgePlugin, revokeSiteBridge } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";

/** The Site Bridge (ticket 68): the Property Manager enrolls it, pushes plugin versions to it and revokes it. */
const PATH = "/settings/site-bridge";
const viewerOf = (p: Awaited<ReturnType<typeof authorize>>) => ({ userId: p.session.user.id, actor: p.actor });

export async function enrollBridgeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const p = await authorize("manage_property_settings", propertyId);
    const { token } = await enrollSiteBridge(pool(), p.tenant.schemaName, p.tenant.id, propertyId, field(formData, "name"), viewerOf(p));
    revalidatePath(PATH);
    return { ok: true, message: `Enrolled. The Bridge's token, shown this once (put it in its bridge.json): ${token}` };
  });
}

export async function pushPluginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const p = await authorize("manage_property_settings", field(formData, "propertyId"));
    const [name, version] = field(formData, "plugin").split("@");
    await pushBridgePlugin(pool(), p.tenant.schemaName, field(formData, "bridgeId"), name ?? "", version ?? "", viewerOf(p));
    revalidatePath(PATH);
    return { ok: true, message: "Sent: the Bridge installs it on its next call." };
  });
}

export async function revokeBridgeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const p = await authorize("manage_property_settings", field(formData, "propertyId"));
    await revokeSiteBridge(pool(), p.tenant.schemaName, field(formData, "bridgeId"), viewerOf(p));
    revalidatePath(PATH);
    return { ok: true, message: "Revoked." };
  });
}
