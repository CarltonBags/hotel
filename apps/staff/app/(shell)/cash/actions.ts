"use server";

import { revalidatePath } from "next/cache";
import { OpeningDifference, closeShiftWithReason, listTenantUsers, openShift, recordCashMovement, submitCloseCount, type CashMovementInput, type CloseResult } from "@hoteloftware/db";
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

/** Opening, counting and closing a Shift: the desk, or outlet staff on their outlet's register (ticket 60; the db layer tells the registers apart). */
async function shiftHolder(propertyId: string) {
  const at = String(propertyId);
  const { tenant, session, actor } = await authorize("outlet_cash", at).catch(() => authorize("handle_cash", at));
  return { schema: tenant.schemaName, tenantId: tenant.id, viewer: { userId: session.user.id, actor }, userName: session.user.name };
}

/** The Property Managers of the property, told about a cash difference above the tolerance. */
async function tellManagers(tenantId: string, propertyId: string, title: string): Promise<void> {
  const managers = (await listTenantUsers(pool(), tenantId)).filter((u) => !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "manage_cash_desk", propertyId));
  for (const m of managers) {
    await publishNotification(pool(), { tenantId, userId: m.id, kind: "cash.difference", title, href: "/cash" }).catch((err) => console.error("notification not sent", err));
  }
}

/** Open a Shift with the counted float; a count off by more than the tolerance needs a reason, and the managers are told. */
export async function openShiftAction(propertyId: string, registerId: string, count: CashCount, reason: string | null): Promise<FormState & { needsReason?: boolean }> {
  let needsReason = false;
  const state = await formAction(async () => {
    const { schema, tenantId, viewer, userName } = await shiftHolder(propertyId);
    try {
      const opened = await openShift(pool(), schema, { registerId: String(registerId), count, reason }, viewer);
      if (reason && opened.difference !== 0) await tellManagers(tenantId, String(propertyId), `Opening count differs by ${opened.difference.toFixed(2)} (${userName}): ${reason.trim()}`);
    } catch (err) {
      if (err instanceof OpeningDifference) needsReason = true;
      throw err;
    }
    revalidatePath(PATH);
    return { ok: true, message: "Shift opened." };
  });
  return { ...state, needsReason };
}

/** The blind close count: the expected amount comes back only now. */
export async function closeCountAction(propertyId: string, shiftId: string, count: CashCount): Promise<FormState & { result?: CloseResult }> {
  let result: CloseResult | undefined;
  const state = await formAction(async () => {
    const { schema, viewer } = await shiftHolder(propertyId);
    result = await submitCloseCount(pool(), schema, { shiftId: String(shiftId), count }, viewer);
    revalidatePath(PATH);
  });
  return { ...state, ...(result ? { result } : {}) };
}

/** Close with the reason for a difference above the tolerance; the property's Property Managers are told. */
export async function closeWithReasonAction(propertyId: string, shiftId: string, reason: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, viewer, userName } = await shiftHolder(propertyId);
    const closed = await closeShiftWithReason(pool(), schema, { shiftId: String(shiftId), reason: String(reason ?? "") }, viewer);
    await tellManagers(tenantId, closed.propertyId, `Cash difference of ${closed.difference.toFixed(2)} at ${closed.registerName} (${userName}): ${String(reason).trim()}`);
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
