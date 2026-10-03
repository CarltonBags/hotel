import { can } from "@hoteloftware/domain";
import { ApprovalRequired, listTenantUsers, loadActor, requestApproval, type ApprovalSubject } from "@hoteloftware/db";
import { verifyTenantCredentials } from "@hoteloftware/auth";
import { publishNotification } from "@hoteloftware/events";
import { auth } from "./auth";
import { pool } from "./db";
import type { FormState } from "./form";

/**
 * Approvals in server actions (ticket 31). An action beyond the user's limit
 * is refused with the Approval it needs; the user then asks a Property
 * Manager (who is notified and approves on the Approvals page) or a Property
 * Manager approves on the same screen with their own credentials. Server only.
 */

/** How the user wants to get past the limit: ask remotely, or a manager's credentials on this screen. */
export type ApprovalMode = { mode: "request" } | { mode: "credentials"; login: string; password: string };

/** A form state that may say which Approval the action needs. */
export interface ApprovalState extends FormState {
  approval?: { summary: string };
}

/** The approver of a same-screen Approval: their credentials at this tenant and their right to approve at the property. */
async function approverFor(tenantId: string, propertyId: string, credentials: { login: string; password: string }, requesterId: string): Promise<string> {
  const id = await verifyTenantCredentials(auth(), pool(), { tenantId, login: String(credentials.login ?? ""), password: String(credentials.password ?? "") });
  if (!id) throw new Error("Wrong username or password for the approving manager");
  if (id === requesterId) throw new Error("An Approval comes from another user");
  if (!can(await loadActor(pool(), tenantId, id), "approve_requests", propertyId)) throw new Error("This user may not approve at this property");
  return id;
}

/** Ask the property's Property Managers: the request is stored and each of them is notified. */
export async function askForApproval(tenant: { id: string; schema: string }, subject: ApprovalSubject, requesterId: string, requesterName: string): Promise<void> {
  const tenantId = tenant.id;
  const request = await requestApproval(pool(), tenant.schema, subject, requesterId);
  if (!request.created) return;
  const managers = (await listTenantUsers(pool(), tenantId)).filter((u) => u.id !== requesterId && !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "approve_requests", subject.propertyId));
  for (const m of managers) {
    await publishNotification(pool(), { tenantId, userId: m.id, kind: "approval.requested", title: `${requesterName} asks for an Approval: ${subject.summary}`, href: "/approvals" }).catch((err) => console.error("notification not sent", err));
  }
}

/**
 * Run an action that may need an Approval. Its body gets the approver of a
 * same-screen Approval (or null); when the action still needs one, the
 * user's choice decides: ask remotely, or report what is needed.
 */
export async function withApproval(
  ctx: { tenantId: string; schema: string; propertyId: string; userId: string; userName: string },
  mode: ApprovalMode | undefined,
  body: (approverId: string | null) => Promise<FormState>,
): Promise<ApprovalState> {
  const approverId = mode?.mode === "credentials" ? await approverFor(ctx.tenantId, ctx.propertyId, mode, ctx.userId) : null;
  try {
    return await body(approverId);
  } catch (err) {
    if (!(err instanceof ApprovalRequired)) throw err;
    if (mode?.mode === "request") {
      await askForApproval({ id: ctx.tenantId, schema: ctx.schema }, err.subject, ctx.userId, ctx.userName);
      return { ok: true, message: "Approval requested. The Property Manager is notified; once approved, do it again here (within 24 hours)." };
    }
    return { error: err.message, approval: { summary: err.subject.summary } };
  }
}
