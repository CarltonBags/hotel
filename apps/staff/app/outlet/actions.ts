"use server";

import { revalidatePath } from "next/cache";
import {
  addBillItem,
  invoiceOutletBill,
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
import { formAction, type FormState } from "@/lib/form";
import { pool } from "@/lib/db";
import { signPaymentReceipts } from "@/lib/fiscal";
import { authorizeOutlet } from "@/lib/outlets";

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
    const { tenant, viewer } = await authorizeOutlet("outlet_cash", { billId });
    const inv = await invoiceOutletBill(pool(), tenant.schemaName, billId, { companyId }, viewer);
    refresh(outletId);
    return { ok: true, message: `Invoice ${inv.number} issued.` };
  });
}

export async function takePrintJobsAction(outletId: string): Promise<PrintJob[]> {
  try {
    const { tenant, viewer } = await authorizeOutlet("outlet_cash", { outletId }).catch(() => authorizeOutlet("serve_outlet", { outletId }));
    return await takePrintJobs(pool(), tenant.schemaName, outletId, viewer);
  } catch {
    return [];
  }
}

export async function reportPrintAction(outletId: string, jobId: string, ok: boolean, error: string): Promise<void> {
  const { tenant, viewer } = await authorizeOutlet("outlet_cash", { outletId }).catch(() => authorizeOutlet("serve_outlet", { outletId }));
  await reportPrintJob(pool(), tenant.schemaName, jobId, { ok, error }, viewer);
}
