"use server";

import { revalidatePath } from "next/cache";
import { closeShiftWithReason, listTenantUsers, openShift, recordCashMovement, submitCloseCount, type CashMovementInput, type CloseResult } from "@hoteloftware/db";
import { can, type CashCount } from "@hoteloftware/domain";
import { publishNotification } from "@hoteloftware/events";
import { type ApprovalMode, type ApprovalState, withApproval } from "@/lib/approval";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { formAction, type FormState } from "@/lib/form";

/** The cash desk (ticket 50): Shifts, the blind close count, Paid-outs and other movements. */

const PATH = "/cash";

async function desk(propertyId: string, action: "handle_cash" | "paid_out" | "manage_cash" = "handle_cash") {
  const { tenant, session, actor } = await authorize(action, String(propertyId));
  return { schema: tenant.schemaName, tenantId: tenant.id, viewer: { userId: session.user.id, actor }, userName: session.user.name };
}

export async function openShiftAction(propertyId: string, registerId: string, count: CashCount): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer } = await desk(propertyId);
    await openShift(pool(), schema, { registerId: String(registerId), count }, viewer);
    revalidatePath(PATH);
    return { ok: true, message: "Shift opened." };
  });
}

/** The blind close count: the expected amount comes back only now. */
export async function closeCountAction(propertyId: string, shiftId: string, count: CashCount): Promise<FormState & { result?: CloseResult }> {
  let result: CloseResult | undefined;
  const state = await formAction(async () => {
    const { schema, viewer } = await desk(propertyId);
    result = await submitCloseCount(pool(), schema, { shiftId: String(shiftId), count }, viewer);
    revalidatePath(PATH);
  });
  return { ...state, ...(result ? { result } : {}) };
}

/** Close with the reason for a difference above the tolerance; the property's Property Managers are told. */
export async function closeWithReasonAction(propertyId: string, shiftId: string, reason: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, viewer, userName } = await desk(propertyId);
    const closed = await closeShiftWithReason(pool(), schema, { shiftId: String(shiftId), reason: String(reason ?? "") }, viewer);
    const managers = (await listTenantUsers(pool(), tenantId)).filter((u) => !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "manage_cash_desk", closed.propertyId));
    for (const m of managers) {
      await publishNotification(pool(), {
        tenantId,
        userId: m.id,
        kind: "cash.difference",
        title: `Cash difference of ${closed.difference.toFixed(2)} at ${closed.registerName} (${userName}): ${String(reason).trim()}`,
        href: "/cash",
      }).catch((err) => console.error("notification not sent", err));
    }
    revalidatePath(PATH);
    return { ok: true, message: "Shift closed. The Property Manager is told about the difference." };
  });
}

/** A Paid-out or a tip paid out from the user's own Shift; above the limit a Paid-out needs an Approval. */
export async function shiftMovementAction(propertyId: string, input: CashMovementInput, mode?: ApprovalMode): Promise<ApprovalState> {
  return formAction(async () => {
    const kind = input?.kind === "paid_out" ? "paid_out" : input?.kind === "tip_out" ? "tip_out" : null;
    if (!kind) throw new Error("Unknown movement");
    const { schema, tenantId, viewer, userName } = await desk(propertyId, kind === "paid_out" ? "paid_out" : "handle_cash");
    return withApproval({ tenantId, schema, propertyId: String(propertyId), userId: viewer.userId, userName }, mode, async (approverId) => {
      await recordCashMovement(pool(), schema, { ...input, kind } as CashMovementInput, { ...viewer, approverId });
      revalidatePath(PATH);
      return { ok: true, message: kind === "paid_out" ? "Paid-out booked." : "Tip paid out booked." };
    });
  });
}

/** Bank deposit, change money, transfer between registers: Property Manager and Accounting. */
export async function registerMovementAction(propertyId: string, input: CashMovementInput): Promise<FormState> {
  return formAction(async () => {
    const { schema, viewer } = await desk(propertyId, "manage_cash");
    if (!["deposit", "change_in", "transfer"].includes(input?.kind)) throw new Error("Unknown movement");
    await recordCashMovement(pool(), schema, input, viewer);
    revalidatePath(PATH);
    return { ok: true, message: "Booked." };
  });
}
