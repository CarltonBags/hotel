"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { TASKS_FROM_MESSAGES, claimConversation, conversationOfReservation, markConversationSeen, messageToTask, postStaffMessage, setConversationDisputed, type TaskFromMessage } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { guestLinks } from "@/lib/env";
import { field, flag, formAction, type FormState } from "@/lib/form";
import { announceConversations, announceTyping, storeConversationFile } from "@/lib/inbox";
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
    const fileId = await storeConversationFile(tenant, formData, propertyId, session.user.id);
    await postStaffMessage(
      pool(),
      tenant.schemaName,
      propertyId,
      field(formData, "conversationId"),
      { userId: session.user.id, name: session.user.name },
      // the guest message on screen when writing: one that came in meanwhile stays unread
      { body: String(formData.get("body") ?? ""), note: flag(formData, "note"), fileId, seenUpTo: field(formData, "seenUpTo") || null },
      guestLinks(tenant.slug),
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

/** A guest's message becomes a Maintenance Issue or Housekeeping Task for the guest's room, linked back (ticket 43). */
export async function messageToTaskAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session, actor } = await inbox(propertyId);
    const kind = field(formData, "kind") as TaskFromMessage;
    if (!TASKS_FROM_MESSAGES.includes(kind)) throw new Error("Choose the kind of work");
    await messageToTask(pool(), tenant.schemaName, propertyId, field(formData, "messageId"), kind, { userId: session.user.id, actor }, field(formData, "roomId") || null);
    revalidatePath("/inbox");
  });
}

/** Keep a Conversation past its retention while a dispute is open, or release it (the Property Manager: a legal hold). */
export async function disputeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await authorize("keep_conversations", propertyId);
    await setConversationDisputed(pool(), tenant.schemaName, propertyId, field(formData, "conversationId"), flag(formData, "disputed"), session.user.id);
    revalidatePath("/inbox");
  });
}

/** The staff member has the Conversation open up to this guest message: unread clears when it is the latest. */
export async function seenAction(propertyId: string, conversationId: string, messageId: string): Promise<void> {
  const { tenant } = await inbox(propertyId);
  if (await markConversationSeen(pool(), tenant.schemaName, propertyId, conversationId, messageId)) await announceConversations(tenant.id, propertyId);
}

/** "Is writing…" for colleagues, sent now and then while typing. */
export async function typingAction(propertyId: string, conversationId: string): Promise<void> {
  const { tenant, session } = await inbox(propertyId);
  await announceTyping(tenant.id, propertyId, conversationId, { id: session.user.id, name: session.user.name });
}

/** From the reservation: its Conversation, made on first use, opened in the inbox. */
export async function openConversationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const r = await reservationScope(field(formData, "reservationId"), "use_guest_inbox");
    const c = await conversationOfReservation(pool(), r.schema, r.reservation.id);
    redirect(`/inbox?c=${c.id}`);
  });
}
