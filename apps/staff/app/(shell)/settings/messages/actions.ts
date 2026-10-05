"use server";

import { revalidatePath } from "next/cache";
import { checkSenderDomain, deleteQuickReply, findProperty, saveQuickReply, setInboxSettings, resetMessageText, setPortalSettings, storeFile, sendTestMessage, setMessageText, setMessagingSettings, setSenderDomain } from "@hoteloftware/db";
import { MESSAGE_TYPES, MESSAGE_TYPE_INFO, isMessageLanguage, isMessageType, type MessageLanguage, type MessageType } from "@hoteloftware/domain";
import { mailProvider } from "@hoteloftware/messaging";
import { fileServices } from "@hoteloftware/storage";
import { authorize } from "@/lib/authorize";
import { platformMailDomain } from "@/lib/env";
import { pool } from "@/lib/db";
import { field, flag, formAction, type FormState } from "@/lib/form";

async function scope(formData: FormData) {
  const propertyId = field(formData, "propertyId");
  const { tenant, session } = await authorize("manage_property_settings", propertyId);
  const property = await findProperty(pool(), tenant.schemaName, propertyId);
  if (!property) throw new Error("Property not found");
  return { schema: tenant.schemaName, tenantId: tenant.id, propertyId: property.id, userId: session.user.id };
}

function typeAndLanguage(formData: FormData): { type: MessageType; language: MessageLanguage } {
  const type = field(formData, "type");
  const language = field(formData, "language");
  if (!isMessageType(type) || !isMessageLanguage(language)) throw new Error("Unknown message type or language");
  return { type, language };
}

export async function messagingSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    const enabled = Object.fromEntries(MESSAGE_TYPES.filter((t) => MESSAGE_TYPE_INFO[t].switchable).map((t) => [t, flag(formData, `on_${t}`)]));
    await setMessagingSettings(
      pool(),
      c.schema,
      c.propertyId,
      {
        sendingFrom: field(formData, "sendingFrom"),
        sendingTo: field(formData, "sendingTo"),
        fallbackLanguage: field(formData, "fallbackLanguage") as MessageLanguage,
        useGuestLanguage: flag(formData, "useGuestLanguage"),
        enabled,
        channelConfirmation: flag(formData, "channelConfirmation"),
        replyTo: field(formData, "replyTo") || null,
        preArrivalDays: Number(field(formData, "preArrivalDays")),
        checkoutTime: field(formData, "checkoutTime"),
      },
      c.userId,
    );
    revalidatePath("/settings/messages");
  });
}

export async function senderDomainAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    await setSenderDomain(pool(), c.schema, { tenantId: c.tenantId, propertyId: c.propertyId, domain: field(formData, "domain") || null, local: field(formData, "local"), platformDomain: platformMailDomain() }, c.userId);
    const status = await checkSenderDomain(pool(), c.schema, c.propertyId, mailProvider());
    revalidatePath("/settings/messages");
    if (!status) return { ok: true, message: "Mail goes from the platform domain with the hotel's name." };
    return status.verified
      ? { ok: true, message: "Verified: mail goes from the hotel's domain." }
      : { ok: true, message: `Not verified yet. Publish these DNS records, then check again: ${status.records.filter((r) => !r.valid).map((r) => `${r.type} ${r.name} = ${r.value}`).join(" | ")}` };
  });
}

export async function messageTextAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    const { type, language } = typeAndLanguage(formData);
    // blocks are paragraphs separated by an empty line
    const blocks = String(formData.get("blocks") ?? "").replace(/\r/g, "").split(/\n\s*\n/);
    await setMessageText(pool(), c.schema, c.propertyId, type, language, { subject: field(formData, "subject"), blocks }, c.userId);
    revalidatePath("/settings/messages");
  });
}

export async function resetMessageTextAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    const { type, language } = typeAndLanguage(formData);
    await resetMessageText(pool(), c.schema, c.propertyId, type, language);
    revalidatePath("/settings/messages");
  });
}

export async function testMessageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    const { type, language } = typeAndLanguage(formData);
    await sendTestMessage(pool(), c.schema, { tenantId: c.tenantId, propertyId: c.propertyId, type, language, userId: c.userId });
    return { ok: true, message: "Test sent to your own address." };
  });
}

/** What the Guest Portal tells guests, and whether they may upload a document picture (ticket 40). */
export async function portalSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    const photo = formData.get("photo");
    const photoFileId =
      photo instanceof File && photo.size > 0
        ? await storeFile(pool(), c.schema, fileServices(), { tenantId: c.tenantId, kind: "portal_photo", bytes: new Uint8Array(await photo.arrayBuffer()), contentType: photo.type, propertyId: c.propertyId, userId: c.userId })
        : flag(formData, "removePhoto")
          ? null
          : undefined;
    await setPortalSettings(pool(), c.schema, c.propertyId, { info: { de: field(formData, "info_de"), en: field(formData, "info_en") }, documentImages: flag(formData, "documentImages"), expressCheckoutAuto: flag(formData, "expressAuto"), photoFileId });
    revalidatePath("/settings/messages");
  });
}

/** Desk Hours, the emergency number and when an unopened guest message goes to the Property Manager (ticket 42). */
export async function inboxSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    await setInboxSettings(pool(), c.schema, c.propertyId, { deskOpens: field(formData, "deskOpens"), deskCloses: field(formData, "deskCloses"), checkinTime: field(formData, "checkinTime"), emergencyPhone: field(formData, "emergencyPhone") || null, escalationMinutes: Number(field(formData, "escalationMinutes")) }, c.userId);
    revalidatePath("/settings/messages");
  });
}

export async function quickReplyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    await saveQuickReply(pool(), c.schema, c.propertyId, { language: field(formData, "language"), title: field(formData, "title"), body: String(formData.get("body") ?? "") });
    revalidatePath("/settings/messages");
  });
}

export async function deleteQuickReplyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    await deleteQuickReply(pool(), c.schema, c.propertyId, field(formData, "id"));
    revalidatePath("/settings/messages");
  });
}
