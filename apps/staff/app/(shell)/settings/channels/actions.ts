"use server";

import { revalidatePath } from "next/cache";
import { connectChannels, enqueueFullPushOf } from "@hoteloftware/db";
import { channelManager } from "@hoteloftware/channels";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";

/** Connect the property to the channel manager (ticket 37): property, room types and rate plans are created there and everything pushed once. */
export async function connectChannelsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await authorize("manage_property_settings", propertyId);
    if (session.support) throw new Error("Connecting channels is the customer's decision, not support's");
    await connectChannels(pool(), tenant.schemaName, { tenantId: tenant.id, propertyId, email: field(formData, "email") }, channelManager(), session.user.id);
    revalidatePath("/settings/channels");
    return { ok: true, message: "Connected. Rates and availability go out within a minute." };
  });
}

/** Push everything once more (as the nightly full push does). */
export async function fullPushAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant } = await authorize("manage_rates", propertyId);
    await enqueueFullPushOf(pool(), tenant.schemaName, propertyId);
    revalidatePath("/settings/channels");
    return { ok: true, message: "Everything goes out again within a minute." };
  });
}
