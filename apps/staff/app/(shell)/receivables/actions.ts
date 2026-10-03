"use server";

import { revalidatePath } from "next/cache";
import { issueReminder, listReceivables, matchTransfer } from "@hoteloftware/db";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { formAction, type FormState } from "@/lib/form";

/** Receivables (ticket 29): every id from the browser is checked against the property's open list. */

async function scope(propertyId: string) {
  const { tenant } = await requirePrincipal();
  const { session } = await authorize("manage_receivables", String(propertyId));
  const open = await listReceivables(pool(), tenant.schemaName, String(propertyId));
  return { schema: tenant.schemaName, userId: session.user.id, open };
}

export async function matchTransferAction(propertyId: string, input: { receivedOn: string; reference: string; allocations: { invoiceId: string; amount: number }[] }): Promise<FormState> {
  return formAction(async () => {
    const { schema, userId, open } = await scope(propertyId);
    const ids = new Set(open.rows.map((r) => r.invoiceId));
    const allocations = (Array.isArray(input.allocations) ? input.allocations : []).map((a) => ({ invoiceId: String(a.invoiceId), amount: Number(a.amount) }));
    if (allocations.some((a) => !ids.has(a.invoiceId))) throw new Error("Invoice not open at this property");
    await matchTransfer(pool(), schema, { receivedOn: String(input.receivedOn), reference: String(input.reference), allocations }, userId);
    revalidatePath("/receivables");
    return { ok: true, message: "Transfer matched." };
  });
}

export async function issueReminderAction(propertyId: string, invoiceId: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, userId, open } = await scope(propertyId);
    if (!open.rows.some((r) => r.invoiceId === String(invoiceId))) throw new Error("Invoice not open at this property");
    const r = await issueReminder(pool(), schema, String(invoiceId), userId);
    revalidatePath("/receivables");
    return { ok: true, message: `Reminder level ${r.level} created.` };
  });
}
