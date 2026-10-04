"use server";

import { revalidatePath } from "next/cache";
import { CheckOutBlocked, checkOut, closeNightAudit, findReservation, listTenantUsers, saveArrivalDecision, updateReservation } from "@hoteloftware/db";
import { addDays, type ArrivalDecision } from "@hoteloftware/domain";
import { renderNightAuditPdf, type NightAuditReportDocument } from "@hoteloftware/invoices";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { loadShell } from "@/lib/shell";
import { pool } from "@/lib/db";
import { announceReservations } from "@/lib/live";
import { formAction, type FormState } from "@/lib/form";

/** Night Audit (ticket 32): Front Desk and Property Manager of the property. */

export async function saveDecisionAction(propertyId: string, reservationId: string, decision: ArrivalDecision | null): Promise<FormState> {
  return formAction(async () => {
    const { tenant, session } = await authorize("run_night_audit", String(propertyId));
    await saveArrivalDecision(pool(), tenant.schemaName, String(propertyId), String(reservationId), decision, session.user.id);
    revalidatePath("/night-audit");
    return { ok: true, message: "Saved." };
  });
}

export async function closeAuditAction(propertyId: string): Promise<FormState> {
  return formAction(async () => {
    const { tenant, session } = await authorize("run_night_audit", String(propertyId));
    const { language } = await loadShell();
    const names = Object.fromEntries((await listTenantUsers(pool(), tenant.id)).map((u) => [u.id, u.name]));
    // the report's PDF is stored with the close, in the closing user's language
    const closed = await closeNightAudit(pool(), tenant.schemaName, String(propertyId), session.user.id, {
      renderPdf: (report) => renderNightAuditPdf(report as NightAuditReportDocument, language === "de" ? "de" : "en", names),
    });
    revalidatePath("/night-audit");
    revalidatePath("/");
    await announceReservations(tenant.id, String(propertyId));
    return { ok: true, message: `Business Date ${closed.businessDate} closed.` };
  });
}

/** A guest past departure, from the audit's step 2: check out (refused while a guest folio is open) or stay one night longer. */
async function dueOut(propertyId: string, reservationId: string, action: "check_in" | "manage_reservations") {
  const { tenant } = await requirePrincipal();
  const r = await findReservation(pool(), tenant.schemaName, String(reservationId));
  if (!r || r.propertyId !== String(propertyId) || r.status !== "checked_in") throw new Error("Not a guest in house at this property");
  const { session } = await authorize(action, r.propertyId);
  return { tenant, r, userId: session.user.id };
}

export async function auditCheckOutAction(propertyId: string, reservationId: string): Promise<FormState> {
  return formAction(async () => {
    const { tenant, r, userId } = await dueOut(propertyId, reservationId, "check_in");
    try {
      await checkOut(pool(), tenant.schemaName, r.id, userId, { override: false });
    } catch (err) {
      if (err instanceof CheckOutBlocked) throw new Error(`${r.booking.confirmationNumber}: ${err.message}. Settle it on the reservation.`);
      throw err;
    }
    revalidatePath("/night-audit");
    await announceReservations(tenant.id, r.propertyId);
    return { ok: true, message: `${r.booking.confirmationNumber} checked out.` };
  });
}

export async function auditExtendAction(propertyId: string, reservationId: string): Promise<FormState> {
  return formAction(async () => {
    const { tenant, r, userId } = await dueOut(propertyId, reservationId, "manage_reservations");
    await updateReservation(pool(), tenant.schemaName, r.id, userId, { departure: addDays(r.departure, 1) });
    revalidatePath("/night-audit");
    await announceReservations(tenant.id, r.propertyId);
    return { ok: true, message: `${r.booking.confirmationNumber} extended by one night.` };
  });
}
