"use server";

import { revalidatePath } from "next/cache";
import { connectChannels, enqueueFullPushOf, resolveChannelProblem, setChannelSetting, setGoogleChannel } from "@hoteloftware/db";
import { channelManager } from "@hoteloftware/channels";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, flag, formAction, type FormState } from "@/lib/form";

/** Connect the property to the channel manager (ticket 37): property, room types and rate plans are created there and everything pushed once. */
export async function connectChannelsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await authorize("manage_property_settings", propertyId);
    if (session.support) throw new Error("Connecting channels is the customer's decision, not support's");
    const manager = channelManager();
    // the worker's public address receives the channel manager's booking webhooks
    const base = process.env.WORKER_PUBLIC_URL?.replace(/\/$/, "");
    const secret = process.env.CHANNEX_WEBHOOK_SECRET;
    const webhook = base && secret ? { url: `${base}/webhooks/${manager.name}`, secret } : undefined;
    await connectChannels(pool(), tenant.schemaName, { tenantId: tenant.id, propertyId, email: field(formData, "email"), webhook }, manager, session.user.id);
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

/** How a channel's bookings arrive (ticket 38): prices with VAT and City Tax or not, our confirmation, money taken by the website tool. */
export async function channelSettingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await authorize("manage_property_settings", propertyId);
    await setChannelSetting(
      pool(),
      tenant.schemaName,
      propertyId,
      { channel: field(formData, "channel"), pricesIncludeVat: flag(formData, "vat"), pricesIncludeCityTax: flag(formData, "cityTax"), sendConfirmation: flag(formData, "confirmation"), paidViaTool: flag(formData, "tool") },
      session.user.id,
    );
    revalidatePath("/settings/channels");
  });
}

export async function googleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant } = await authorize("manage_property_settings", propertyId);
    await setGoogleChannel(pool(), tenant.schemaName, propertyId, flag(formData, "google"));
    revalidatePath("/settings/channels");
  });
}

/** A channel booking problem seen to. */
export async function resolveProblemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await authorize("manage_reservations", propertyId);
    await resolveChannelProblem(pool(), tenant.schemaName, propertyId, field(formData, "revisionId"), session.user.id);
    revalidatePath("/settings/channels");
  });
}
