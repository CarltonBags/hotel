import { listTenantUsers } from "@hoteloftware/db";
import { can } from "@hoteloftware/domain";
import { publishDataChange, publishNotification } from "@hoteloftware/events";
import { pool } from "./db";

/**
 * Guest Inbox live updates (ticket 42): open inboxes and the navbar badge
 * refresh when a Conversation changes; a new guest message is a toast for
 * whoever works the property's inbox (in the app only, never by email). A
 * failure to announce never fails the message itself.
 */
export async function announceConversations(tenantId: string, propertyId: string): Promise<void> {
  try {
    await publishDataChange(pool(), { tenantId, kind: "conversations", propertyId });
  } catch (err) {
    console.error("live update not sent", err);
  }
}

export async function toastGuestMessage(tenant: { id: string }, m: { propertyId: string; conversationId: string; guestName: string; text: string }): Promise<void> {
  try {
    const users = (await listTenantUsers(pool(), tenant.id)).filter((u) => !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "use_guest_inbox", m.propertyId));
    const firstLine = m.text.split("\n")[0]!.slice(0, 120);
    for (const u of users) {
      await publishNotification(pool(), { tenantId: tenant.id, userId: u.id, kind: "inbox.message", title: m.guestName || "Guest message", body: firstLine || "📎", href: `/inbox?c=${m.conversationId}` });
    }
  } catch (err) {
    console.error("inbox toast not sent", err);
  }
}
