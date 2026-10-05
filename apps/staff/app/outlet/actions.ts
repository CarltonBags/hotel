"use server";

import { revalidatePath } from "next/cache";
import {
  addBillItem,
  cancelPendingPayment,
  chargeBillToRoom,
  invoiceOutletBill,
  payOutletBillVoucher,
  roomChargeGuests,
  setBillDiscount,
  simulateCard,
  startOutletCardPayment,
  syncPayment,
  voidBillLine,
  type RoomChargeGuest,
  moveOutletBill,
  openOutletBill,
  payOutletBillCash,
  removeBillLine,
  reportPrintJob,
  sendOrderRound,
  splitOutletBill,
  takePrintJobs,
  type PrintJob,
} from "@hoteloftware/db";
import type { Actor } from "@hoteloftware/domain";
import { paymentProvider, type SimulatedCard } from "@hoteloftware/payments";
import { withApproval, type ApprovalMode, type ApprovalState } from "@/lib/approval";
import { formAction, type FormState } from "@/lib/form";
import { pool } from "@/lib/db";
import { signPaymentReceipts } from "@/lib/fiscal";
import { authorizeOutlet } from "@/lib/outlets";

/** The user at the outlet, as the db layer checks them. */
type Viewer = { userId: string; actor: Actor; name: string };

/** The outlet app (ticket 60): every action checked at the outlet's property with the Point of Sale Module on (the db layer checks again). */
const refresh = (outletId: string) => revalidatePath(`/outlet/${outletId}`, "layout");

export async function openBillAction(outletId: string, tableId: string | null, label: string): Promise<FormState & { billId?: string }> {
  let billId: string | undefined;
  const r = await formAction(async () => {
    const { tenant, viewer } = await authorizeOutlet("serve_outlet", { outletId });
    billId = await openOutletBill(pool(), tenant.schemaName, outletId, { tableId, label }, viewer);
    refresh(outletId);
  });
  return { ...r, ...(billId ? { billId } : {}) };
}

export async function addItemAction(outletId: string, billId: string, input: { menuItemId: string; quantity: number; modifiers: string[]; note: string }): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer } = await authorizeOutlet("serve_outlet", { billId });
    await addBillItem(pool(), tenant.schemaName, billId, input, viewer);
    refresh(outletId);
  });
}

export async function removeLineAction(outletId: string, billId: string, lineId: string): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer } = await authorizeOutlet("serve_outlet", { billId });
    await removeBillLine(pool(), tenant.schemaName, billId, lineId, viewer);
    refresh(outletId);
  });
}

export async function sendRoundAction(outletId: string, billId: string): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer } = await authorizeOutlet("serve_outlet", { billId });
    const r = await sendOrderRound(pool(), tenant.schemaName, billId, viewer);
    refresh(outletId);
    return { ok: true, message: r.round ? `Round ${r.round} sent (${r.jobs} printer${r.jobs === 1 ? "" : "s"}).` : "Nothing new to send." };
  });
}

export async function splitAction(outletId: string, billId: string, lineIds: string[]): Promise<FormState & { billId?: string }> {
  let newId: string | undefined;
  const r = await formAction(async () => {
    const { tenant, viewer } = await authorizeOutlet("serve_outlet", { billId });
    newId = await splitOutletBill(pool(), tenant.schemaName, billId, lineIds, viewer);
    refresh(outletId);
  });
  return { ...r, ...(newId ? { billId: newId } : {}) };
}

export async function moveAction(outletId: string, billId: string, tableId: string | null): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer } = await authorizeOutlet("serve_outlet", { billId });
    await moveOutletBill(pool(), tenant.schemaName, billId, tableId, viewer);
    refresh(outletId);
    return { ok: true, message: "Moved." };
  });
}

export async function payCashAction(outletId: string, billId: string, customerName: string): Promise<FormState & { receiptToken?: string }> {
  let token: string | undefined;
  const r = await formAction(async () => {
    const { tenant, viewer } = await authorizeOutlet("outlet_cash", { billId });
    const paid = await payOutletBillCash(pool(), tenant.schemaName, billId, { customerName }, viewer);
    token = paid.receiptToken;
    // the Receipt signed right after the payment, as at the desk
    await signPaymentReceipts(tenant, paid.paymentId);
    refresh(outletId);
  });
  return { ...r, ...(token ? { receiptToken: token } : {}) };
}

export async function invoiceBillAction(outletId: string, billId: string, companyId: string): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer } = await authorizeOutlet("serve_outlet", { billId });
    const inv = await invoiceOutletBill(pool(), tenant.schemaName, billId, { companyId }, viewer);
    refresh(outletId);
    return { ok: true, message: `Invoice ${inv.number} issued.` };
  });
}

/** Whoever works the outlet's tables or till prints its tickets. */
const printer = (outletId: string) => authorizeOutlet("outlet_cash", { outletId }).catch(() => authorizeOutlet("serve_outlet", { outletId }));

export async function takePrintJobsAction(outletId: string): Promise<PrintJob[]> {
  try {
    const { tenant, viewer } = await printer(outletId);
    return await takePrintJobs(pool(), tenant.schemaName, outletId, viewer);
  } catch (err) {
    // polled every few seconds: a refusal or outage is logged, the device tries again
    console.error("[outlet] print jobs", err);
    return [];
  }
}

export async function reportPrintAction(outletId: string, jobId: string, ok: boolean, error: string): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer } = await printer(outletId);
    await reportPrintJob(pool(), tenant.schemaName, jobId, { ok, error }, viewer);
  });
}

// ── paying and closing (ticket 61) ──

/** An action that may need an Outlet Manager's Approval: asked on the device with their credentials, or remotely. */
async function outletApproval(billId: string, mode: ApprovalMode | undefined, body: (viewer: Viewer & { approverId: string | null }, schema: string) => Promise<FormState>): Promise<ApprovalState> {
  const { tenant, viewer, propertyId } = await authorizeOutlet("outlet_cash", { billId }).catch(() => authorizeOutlet("serve_outlet", { billId }));
  return withApproval({ tenantId: tenant.id, schema: tenant.schemaName, propertyId, userId: viewer.userId, userName: viewer.name }, mode, (approverId) => formAction(() => body({ ...viewer, approverId }, tenant.schemaName)));
}

export async function discountAction(outletId: string, billId: string, percent: number, mode?: ApprovalMode): Promise<ApprovalState> {
  return outletApproval(billId, mode, async (viewer, schema) => {
    await setBillDiscount(pool(), schema, billId, Number(percent), viewer);
    refresh(outletId);
    return { ok: true, message: "Discount set." };
  });
}

export async function voidLineAction(outletId: string, billId: string, lineId: string, reason: string, mode?: ApprovalMode): Promise<ApprovalState> {
  return outletApproval(billId, mode, async (viewer, schema) => {
    await voidBillLine(pool(), schema, billId, lineId, String(reason ?? ""), viewer);
    refresh(outletId);
    return { ok: true, message: "Item voided." };
  });
}

export async function roomGuestsAction(outletId: string, query: string): Promise<RoomChargeGuest[]> {
  const { tenant, viewer } = await authorizeOutlet("outlet_cash", { outletId });
  return roomChargeGuests(pool(), tenant.schemaName, outletId, String(query ?? ""), viewer);
}

export async function roomChargeAction(outletId: string, billId: string, reservationId: string, signature: string | null, mode?: ApprovalMode): Promise<ApprovalState> {
  return outletApproval(billId, mode, async (viewer, schema) => {
    const r = await chargeBillToRoom(pool(), schema, billId, { reservationId: String(reservationId), signature: signature ? String(signature) : null }, viewer);
    refresh(outletId);
    return { ok: true, message: `Charged to the room (${r.charges} Charge${r.charges === 1 ? "" : "s"}).` };
  });
}

export async function payVoucherAction(outletId: string, billId: string, code: string, customerName: string): Promise<FormState & { receiptToken?: string }> {
  let token: string | undefined;
  const r = await formAction(async () => {
    const { tenant, viewer } = await authorizeOutlet("outlet_cash", { billId });
    const paid = await payOutletBillVoucher(pool(), tenant.schemaName, billId, { code: String(code ?? ""), customerName: String(customerName ?? "") }, viewer);
    token = paid.receiptToken;
    await signPaymentReceipts(tenant, paid.paymentId);
    refresh(outletId);
  });
  return { ...r, ...(token ? { receiptToken: token } : {}) };
}

/** Card on a paired reader, or tap to pay on a staff phone: the payment waits at the device. */
export async function startCardAction(outletId: string, billId: string, readerId: string, tip: number): Promise<FormState & { paymentId?: string }> {
  let paymentId: string | undefined;
  const r = await formAction(async () => {
    const { tenant, viewer } = await authorizeOutlet("outlet_cash", { billId });
    paymentId = (await startOutletCardPayment(pool(), tenant.schemaName, paymentProvider(), billId, { readerId: String(readerId), tip: Number(tip) || 0 }, viewer)).id;
    refresh(outletId);
  });
  return { ...r, ...(paymentId ? { paymentId } : {}) };
}

/** The device polls the waiting payment; once settled its Receipt is signed. */
export async function pollCardAction(outletId: string, billId: string, paymentId: string): Promise<{ status: string; error: string | null }> {
  const { tenant } = await authorizeOutlet("outlet_cash", { billId });
  const p = await syncPayment(pool(), tenant.schemaName, paymentProvider(), String(paymentId));
  if (p.status !== "pending") {
    if (p.status === "succeeded") await signPaymentReceipts(tenant, p.id);
    refresh(outletId);
  }
  return { status: p.status, error: p.error };
}

export async function cancelCardAction(outletId: string, billId: string, paymentId: string): Promise<FormState> {
  return formAction(async () => {
    const { tenant } = await authorizeOutlet("outlet_cash", { billId });
    await cancelPendingPayment(pool(), tenant.schemaName, paymentProvider(), String(paymentId));
    refresh(outletId);
  });
}

/** Test mode: present a test card (its brand, a tip added on the reader) to the device. */
export async function simulateCardAction(outletId: string, billId: string, paymentId: string, card: SimulatedCard): Promise<FormState> {
  return formAction(async () => {
    const { tenant } = await authorizeOutlet("outlet_cash", { billId });
    await simulateCard(pool(), tenant.schemaName, paymentProvider(), { paymentId: String(paymentId) }, card);
    await signPaymentReceipts(tenant, String(paymentId));
    refresh(outletId);
  });
}
