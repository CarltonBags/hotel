"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { claimConversation, conversationOfReservation, markConversationSeen, postStaffMessage, storeFile } from "@hoteloftware/db";
import { publishTyping } from "@hoteloftware/events";
import { fileServices } from "@hoteloftware/storage";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { portalBaseUrl } from "@/lib/env";
import { field, flag, formAction, type FormState } from "@/lib/form";
import { announceConversations } from "@/lib/inbox";
import { reservationScope } from "@/lib/reservation-scope";

/** The Guest Inbox (ticket 42): the property comes with the form; the right is checked there. */
async function inbox(propertyId: string) {
  return authorize("use_guest_inbox", propertyId);
}

/** Answer the guest (emailed with the Portal Link) or leave an Internal Note; an image or PDF up to 10 MB. */
export async function sendMessageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await inbox(propertyId);
    const file = formData.get("file");
    const fileId =
      file instanceof File && file.size > 0
        ? await storeFile(pool(), tenant.schemaName, fileServices(), { tenantId: tenant.id, kind: "conversation_file", bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type, propertyId, userId: session.user.id })
        : null;
    await postStaffMessage(
      pool(),
      tenant.schemaName,
      propertyId,
      field(formData, "conversationId"),
      { userId: session.user.id, name: session.user.name },
      { body: String(formData.get("body") ?? ""), note: flag(formData, "note"), fileId },
      { base: portalBaseUrl(tenant.slug) },
    );
    await announceConversations(tenant.id, propertyId);
    revalidatePath("/inbox");
    return { ok: true };
  });
}

export async function claimAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await inbox(propertyId);
    await claimConversation(pool(), tenant.schemaName, propertyId, field(formData, "conversationId"), field(formData, "release") ? null : { userId: session.user.id, name: session.user.name });
    await announceConversations(tenant.id, propertyId);
    revalidatePath("/inbox");
  });
}

/** The staff member has the Conversation open up to this guest message: unread clears when it is the latest. */
export async function seenAction(propertyId: string, conversationId: string, messageId: string): Promise<void> {
  const { tenant } = await inbox(propertyId);
  await markConversationSeen(pool(), tenant.schemaName, propertyId, conversationId, messageId);
  await announceConversations(tenant.id, propertyId);
}

/** "Is writing…" for colleagues, sent now and then while typing. */
export async function typingAction(propertyId: string, conversationId: string): Promise<void> {
  const { tenant, session } = await inbox(propertyId);
  await publishTyping(pool(), { tenantId: tenant.id, propertyId, conversationId, userId: session.user.id, name: session.user.name }).catch(() => undefined);
}

/** From the reservation: its Conversation, made on first use, opened in the inbox. */
export async function openConversationAction(formData: FormData): Promise<void> {
  const r = await reservationScope(field(formData, "reservationId"), "use_guest_inbox");
  const c = await conversationOfReservation(pool(), r.schema, r.reservation.id);
  redirect(`/inbox?c=${c.id}`);
}
