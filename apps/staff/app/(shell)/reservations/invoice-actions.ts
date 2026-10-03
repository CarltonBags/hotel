"use server";

import { revalidatePath } from "next/cache";
import { can } from "@hoteloftware/domain";
import { CheckOutBlocked, cancelInvoice, checkOut, issueInvoice, listInvoices, loadFolios } from "@hoteloftware/db";
import { announceReservations } from "@/lib/live";
import { reservationScope } from "@/lib/reservation-scope";
import { pool } from "@/lib/db";
import { formAction, type FormState } from "@/lib/form";

/** Invoices and check-out on one reservation (ticket 28); the reservation's own property decides each right. */

export async function issueInvoiceAction(reservationId: string, folioId: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId, "issue_invoices");
    if (!(await loadFolios(pool(), schema, reservation.id)).folios.some((f) => f.id === String(folioId))) throw new Error("Folio not found on this reservation");
    const inv = await issueInvoice(pool(), schema, String(folioId), userId);
    revalidatePath(`/reservations/${reservation.id}`);
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: `Invoice ${inv.number} issued.` };
  });
}

/** Correct an issued invoice: a Cancellation Invoice; its Charges are free to be moved and invoiced again. */
export async function cancelInvoiceAction(reservationId: string, invoiceId: string, reason: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId, "correct_invoices");
    if (!(await listInvoices(pool(), schema, reservation.id)).some((i) => i.id === String(invoiceId))) throw new Error("Invoice not found on this reservation");
    const cxl = await cancelInvoice(pool(), schema, String(invoiceId), String(reason), userId);
    revalidatePath(`/reservations/${reservation.id}`);
    revalidatePath("/receivables");
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: `Cancellation Invoice ${cxl.number} issued. Correct the folio and issue the invoice again.` };
  });
}

export interface CheckOutState extends FormState {
  /** Refused: the folios still open. */
  open?: { folioNumber: number; billToName: string; balance: number }[];
}

/** Check out; with `override` (Property Manager) despite open balances. */
export async function checkOutAction(reservationId: string, override: boolean): Promise<CheckOutState> {
  let open: CheckOutState["open"];
  const state = await formAction(async () => {
    const { schema, tenantId, reservation, userId, actor } = await reservationScope(reservationId, "check_in");
    // the permission matrix gives this to the Property Manager alone (no Approval row); revisit with Night Audit (ticket 32) if Front Desk needs it
    if (override && !can(actor, "override_check_out", reservation.propertyId)) throw new Error("Only a Property Manager checks out with balances open");
    try {
      await checkOut(pool(), schema, reservation.id, userId, { override: override === true });
    } catch (err) {
      if (err instanceof CheckOutBlocked) open = err.open;
      throw err;
    }
    revalidatePath(`/reservations/${reservation.id}`);
    revalidatePath("/");
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: "Checked out." };
  });
  return { ...state, ...(open ? { open } : {}) };
}
