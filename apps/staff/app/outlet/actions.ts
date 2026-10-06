"use server";

import { revalidatePath } from "next/cache";
import {
  addBillItem,
  cancelPendingPayment,
  chargeBillToRoom,
  outletBill,
  refundPayment,
  reopenPayingBill,
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
  signOutletOrders,
  splitOutletBill,
  takePrintJobs,
  type PrintJob,
  type Viewer as DbViewer,
} from "@hoteloftware/db";
import { decidesAtOutlet } from "@hoteloftware/domain";
import { paymentProvider, type SimulatedCard } from "@hoteloftware/payments";
import { withApproval, type ApprovalMode, type ApprovalState } from "@/lib/approval";
import { formAction, type FormState } from "@/lib/form";
import { pool } from "@/lib/db";
import { fiscalDeps, signPaymentReceipts } from "@/lib/fiscal";
import { authorizeOutlet } from "@/lib/outlets";

/** The user at the outlet, as the db layer checks them, with the name printed on tickets. */
type Viewer = DbViewer & { name: string };

/**
 * The outlet app (ticket 60): every action checked at the outlet's property
 * with the Point of Sale Module on. Taking orders is checked per outlet by the
 * db layer (Service at a restaurant, Spa Staff at a spa); here only that the
 * user works an outlet till at all.
 */
const refresh = (outletId: string) => revalidatePath(`/outlet/${outletId}`, "layout");

export async function openBillAction(outletId: string, tableId: string | null, label: string): Promise<FormState & { billId?: string }> {
  let billId: string | undefined;
  const r = await formAction(async () => {
    const { tenant, viewer } = await authorizeOutlet("outlet_cash", { outletId });
    billId = await openOutletBill(pool(), tenant.schemaName, outletId, { tableId, label }, viewer);
    refresh(outletId);
  });
  return { ...r, ...(billId ? { billId } : {}) };
}

export async function addItemAction(outletId: string, billId: string, input: { menuItemId: string; quantity: number; modifiers: string[]; note: string }): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer } = await authorizeOutlet("outlet_cash", { billId });
    await addBillItem(pool(), tenant.schemaName, billId, input, viewer);
    refresh(outletId);
  });
}

export async function removeLineAction(outletId: string, billId: string, lineId: string): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer } = await authorizeOutlet("outlet_cash", { billId });
    await removeBillLine(pool(), tenant.schemaName, billId, lineId, viewer);
    refresh(outletId);
  });
}

export async function sendRoundAction(outletId: string, billId: string): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer } = await authorizeOutlet("outlet_cash", { billId });
    const r = await sendOrderRound(pool(), tenant.schemaName, billId, viewer);
    // Germany: the round's order signed now, well inside its 45 seconds (the worker signs any left)
    await signOutletOrders(pool(), tenant.schemaName, fiscalDeps(), { billId }).catch((err) => console.error("[fiscal] orders", err));
    refresh(outletId);
    return { ok: true, message: r.round ? `Round ${r.round} sent (${r.jobs} printer${r.jobs === 1 ? "" : "s"}).` : "Nothing new to send." };
  });
}

export async function splitAction(outletId: string, billId: string, lineIds: string[]): Promise<FormState & { billId?: string }> {
  let newId: string | undefined;
  const r = await formAction(async () => {
    const { tenant, viewer } = await authorizeOutlet("outlet_cash", { billId });
    newId = await splitOutletBill(pool(), tenant.schemaName, billId, lineIds, viewer);
    refresh(outletId);
  });
  return { ...r, ...(newId ? { billId: newId } : {}) };
}

export async function moveAction(outletId: string, billId: string, tableId: string | null): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer } = await authorizeOutlet("outlet_cash", { billId });
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
    const { tenant, viewer } = await authorizeOutlet("outlet_cash", { billId });
    const inv = await invoiceOutletBill(pool(), tenant.schemaName, billId, { companyId }, viewer);
    refresh(outletId);
    return { ok: true, message: `Invoice ${inv.number} issued.` };
  });
}

/** Whoever works the outlet's tables or till prints its tickets (every outlet role holds outlet_cash). */
const printer = (outletId: string) => authorizeOutlet("outlet_cash", { outletId });

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
  const { tenant, viewer, propertyId } = await authorizeOutlet("outlet_cash", { billId });
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

/** The bill's own waiting card payment: an id from the browser is only taken when it is that one. */
async function billPayment(billId: string, paymentId: string) {
  const { tenant, viewer } = await authorizeOutlet("outlet_cash", { billId });
  const bill = await outletBill(pool(), tenant.schemaName, billId, viewer);
  if (!bill.pendingPaymentId || bill.pendingPaymentId !== String(paymentId)) throw new Error("No card payment is waiting on this bill");
  return { tenant, viewer, paymentId: bill.pendingPaymentId };
}

/** The device polls the waiting payment; once settled its Receipt is signed. */
export async function pollCardAction(outletId: string, billId: string, paymentId: string): Promise<{ status: string; error: string | null }> {
  const { tenant } = await billPayment(billId, paymentId).catch(() => ({ tenant: null }));
  if (!tenant) return { status: "failed", error: "No card payment is waiting on this bill" };
  const p = await syncPayment(pool(), tenant.schemaName, paymentProvider(), String(paymentId));
  if (p.status !== "pending") {
    if (p.status === "succeeded") await signPaymentReceipts(tenant, p.id);
    refresh(outletId);
  }
  return { status: p.status, error: p.error };
}

export async function cancelCardAction(outletId: string, billId: string, paymentId: string): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer, paymentId: id } = await billPayment(billId, paymentId);
    await cancelPendingPayment(pool(), tenant.schemaName, paymentProvider(), id);
    // a payment given up before it reached the reader leaves the bill open again
    await reopenPayingBill(pool(), tenant.schemaName, billId, viewer);
    refresh(outletId);
  });
}

/** Give money back on a paid outlet bill: the outlet's Outlet Manager or the Property Manager, else with an Approval (cash out of the user's Shift). */
export async function refundOutletAction(outletId: string, billId: string, paymentId: string, amount: number, reason: string, mode?: ApprovalMode): Promise<ApprovalState> {
  const { tenant, viewer, propertyId } = await authorizeOutlet("outlet_cash", { billId });
  const bill = await outletBill(pool(), tenant.schemaName, billId, viewer);
  if (!bill.payments.some((p) => p.id === String(paymentId))) return { error: "Payment not found on this bill" };
  return withApproval({ tenantId: tenant.id, schema: tenant.schemaName, propertyId, userId: viewer.userId, userName: viewer.name }, mode, (approverId) =>
    formAction(async () => {
      await refundPayment(pool(), tenant.schemaName, paymentProvider(), { paymentId: String(paymentId), amount: Number(amount), reason: String(reason ?? "") }, { userId: viewer.userId, unlimited: decidesAtOutlet(viewer.actor, viewer.userId, bill.outlet), approverId });
      refresh(outletId);
      return { ok: true, message: "Refunded." };
    }),
  );
}

/** Test mode: present a test card (its brand, a tip added on the reader) to the device. */
export async function simulateCardAction(outletId: string, billId: string, paymentId: string, card: SimulatedCard): Promise<FormState> {
  return formAction(async () => {
    const { tenant, paymentId: id } = await billPayment(billId, paymentId);
    await simulateCard(pool(), tenant.schemaName, paymentProvider(), { paymentId: id }, card);
    await signPaymentReceipts(tenant, id);
    refresh(outletId);
  });
}
