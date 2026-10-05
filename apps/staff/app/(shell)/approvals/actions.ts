"use server";

import { revalidatePath } from "next/cache";
import { decideApproval, findApproval, listTenantUsers } from "@hoteloftware/db";
import { approvalRight } from "@hoteloftware/domain";
import { notifyStaff } from "@hoteloftware/events";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { formAction, type FormState } from "@/lib/form";

/** Approve or reject a request (ticket 31): a Property Manager of the request's own property (an Outlet Manager for outlet requests); the requester is told. */
export async function decideApprovalAction(approvalId: string, approve: boolean, note: string): Promise<FormState> {
  return formAction(async () => {
    const { tenant } = await requirePrincipal();
    const request = await findApproval(pool(), tenant.schemaName, String(approvalId));
    if (!request) throw new Error("Approval request not found");
    // outlet Approvals are an Outlet Manager's too (ticket 61)
    const { session } = await authorize(approvalRight(request.kind), request.propertyId);
    const decided = await decideApproval(pool(), tenant.schemaName, request.id, { approve: approve === true, note: String(note ?? "") }, session.user.id);
    const requester = (await listTenantUsers(pool(), tenant.id)).filter((u) => u.id === decided.requestedBy);
    await notifyStaff(pool(), tenant, requester, {
      propertyId: request.propertyId,
      kind: decided.status === "approved" ? "approval.approved" : "approval.rejected",
      title: `${session.user.name} ${decided.status === "approved" ? "approved" : "rejected"}: ${decided.summary}${decided.status === "approved" ? ". Do it again now, within 24 hours of your request." : ""}`,
      ...(decided.recordId ? { href: `/reservations/${decided.recordId}` } : {}),
    }).catch((err) => console.error("notification not sent", err));
    revalidatePath("/approvals");
    return { ok: true, message: decided.status === "approved" ? "Approved." : "Rejected." };
  });
}
