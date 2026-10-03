"use server";

import { revalidatePath } from "next/cache";
import { decideApproval, findApproval } from "@hoteloftware/db";
import { publishNotification } from "@hoteloftware/events";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { formAction, type FormState } from "@/lib/form";

/** Approve or reject a request (ticket 31): a Property Manager of the request's own property; the requester is told. */
export async function decideApprovalAction(approvalId: string, approve: boolean, note: string): Promise<FormState> {
  return formAction(async () => {
    const { tenant } = await requirePrincipal();
    const request = await findApproval(pool(), tenant.schemaName, String(approvalId));
    if (!request) throw new Error("Approval request not found");
    const { session } = await authorize("approve_requests", request.propertyId);
    const decided = await decideApproval(pool(), tenant.schemaName, request.id, { approve: approve === true, note: String(note ?? "") }, session.user.id);
    await publishNotification(pool(), {
      tenantId: tenant.id,
      userId: decided.requestedBy,
      kind: decided.status === "approved" ? "approval.approved" : "approval.rejected",
      title: `${session.user.name} ${decided.status === "approved" ? "approved" : "rejected"}: ${decided.summary}${decided.status === "approved" ? ". Do it again now (within 24 hours)." : ""}`,
      ...(decided.recordId && decided.kind !== "refund_over_limit" ? { href: `/reservations/${decided.recordId}` } : {}),
    }).catch((err) => console.error("notification not sent", err));
    revalidatePath("/approvals");
    return { ok: true, message: decided.status === "approved" ? "Approved." : "Rejected." };
  });
}
