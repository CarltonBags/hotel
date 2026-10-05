import { listTenantUsers, storeFile, type TenantUser } from "@hoteloftware/db";
import { can } from "@hoteloftware/domain";
import { publishDataChange, publishNotification, publishTyping } from "@hoteloftware/events";
import { fileServices } from "@hoteloftware/storage";
import { pool } from "./db";

/**
 * Guest Inbox live updates (ticket 42): open inboxes and the navbar badge
 * refresh when a Conversation changes; a new guest message is a toast for
 * whoever works the property's inbox (in the app only, never by email); a
 * colleague writing shows to the others. A failure to announce never fails
 * the message itself.
 */
export async function announceConversations(tenantId: string, propertyId: string): Promise<void> {
  try {
    await publishDataChange(pool(), { tenantId, kind: "conversations", propertyId });
  } catch (err) {
    console.error("live update not sent", err);
  }
}

async function inboxUsers(tenantId: string, propertyId: string): Promise<TenantUser[]> {
  return (await listTenantUsers(pool(), tenantId)).filter((u) => !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "use_guest_inbox", propertyId));
}

export async function toastGuestMessage(tenant: { id: string }, m: { propertyId: string; conversationId: string; guestName: string; text: string }): Promise<void> {
  try {
    const firstLine = m.text.split("\n")[0]!.slice(0, 120);
    for (const u of await inboxUsers(tenant.id, m.propertyId)) {
      await publishNotification(pool(), { tenantId: tenant.id, userId: u.id, kind: "inbox.message", title: m.guestName || "Guest message", body: firstLine || "📎", href: `/inbox?c=${m.conversationId}` });
    }
  } catch (err) {
    console.error("inbox toast not sent", err);
  }
}

export async function announceTyping(tenantId: string, propertyId: string, conversationId: string, user: { id: string; name: string }): Promise<void> {
  try {
    const to = (await inboxUsers(tenantId, propertyId)).map((u) => u.id);
    await publishTyping(pool(), { tenantId, propertyId, conversationId, userId: user.id, name: user.name, to });
  } catch (err) {
    console.error("typing not announced", err);
  }
}

/** An image or PDF sent in a Conversation: checked, virus-scanned and stored; null when none was chosen. */
export async function storeConversationFile(tenant: { id: string; schemaName: string }, formData: FormData, propertyId: string, userId: string): Promise<string | null> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  return storeFile(pool(), tenant.schemaName, fileServices(), { tenantId: tenant.id, kind: "conversation_file", bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type, propertyId, userId });
}
