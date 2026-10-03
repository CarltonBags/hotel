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
export type ApprovalMode = { mode: "request" } | { mode: "credentials"; username: string; password: string };

/** A form state that may say which Approval the action needs. */
export interface ApprovalState extends FormState {
  approval?: { summary: string };
}

/** Everything an action that may need an Approval knows about its user and property. */
export interface ApprovalContext {
  tenantId: string;
  schema: string;
  propertyId: string;
  userId: string;
  userName: string;
}

// failed same-screen approvals per requesting user: a few tries, then a pause (per server instance)
const FAILED_TRIES = 5;
const PAUSE_MS = 15 * 60 * 1000;
const failures = new Map<string, number[]>();
function tooManyFailures(userId: string): boolean {
  const now = Date.now();
  const recent = (failures.get(userId) ?? []).filter((t) => now - t < PAUSE_MS);
  failures.set(userId, recent);
  return recent.length >= FAILED_TRIES;
}

/** The approver of a same-screen Approval: their credentials at this tenant and their right to approve at the property. One answer for every failure. */
async function approverFor(ctx: ApprovalContext, credentials: { username: string; password: string }): Promise<string> {
  if (tooManyFailures(ctx.userId)) throw new Error("Too many failed approvals; ask a Property Manager remotely or try again later");
  const id = await verifyTenantCredentials(auth(), pool(), { tenantId: ctx.tenantId, username: String(credentials.username ?? ""), password: String(credentials.password ?? "") });
  const ok = id !== null && id !== ctx.userId && can(await loadActor(pool(), ctx.tenantId, id), "approve_requests", ctx.propertyId);
  if (!ok) {
    failures.get(ctx.userId)!.push(Date.now());
    throw new Error("These credentials cannot approve here");
  }
  return id;
}

/** Ask the property's Property Managers: the request is stored and each of them is notified, with a link to the property's requests. */
async function askForApproval(ctx: ApprovalContext, subject: ApprovalSubject): Promise<void> {
  const request = await requestApproval(pool(), ctx.schema, subject, ctx.userId);
  if (!request.created) return;
  const managers = (await listTenantUsers(pool(), ctx.tenantId)).filter(
    (u) => u.id !== ctx.userId && !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "approve_requests", subject.propertyId),
  );
  for (const m of managers) {
    await publishNotification(pool(), {
      tenantId: ctx.tenantId,
      userId: m.id,
      kind: "approval.requested",
      title: `${ctx.userName} asks for an Approval: ${subject.summary}`,
      href: `/approvals?property=${subject.propertyId}`,
    }).catch((err) => console.error("notification not sent", err));
  }
}

/**
 * Run an action that may need an Approval. The body runs with no approver
 * first; only when it needs one does the user's choice count: a manager's
 * credentials (checked then, and the body runs again with them) or a
 * remote request.
 */
export async function withApproval(ctx: ApprovalContext, mode: ApprovalMode | undefined, body: (approverId: string | null) => Promise<FormState>): Promise<ApprovalState> {
  try {
    return await body(null);
  } catch (err) {
    if (!(err instanceof ApprovalRequired)) throw err;
    if (mode?.mode === "credentials") return body(await approverFor(ctx, mode));
    if (mode?.mode === "request") {
      await askForApproval(ctx, err.subject);
      return { ok: true, message: "Approval requested. The Property Manager is notified; once approved, do it again here within 24 hours of this request." };
    }
    return { error: err.message, approval: { summary: err.subject.summary } };
  }
}
