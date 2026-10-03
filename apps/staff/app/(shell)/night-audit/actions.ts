"use server";

import { revalidatePath } from "next/cache";
import { closeNightAudit, saveArrivalDecision } from "@hoteloftware/db";
import type { ArrivalDecision } from "@hoteloftware/domain";
import { authorize } from "@/lib/authorize";
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
    const closed = await closeNightAudit(pool(), tenant.schemaName, String(propertyId), session.user.id);
    revalidatePath("/night-audit");
    revalidatePath("/");
    await announceReservations(tenant.id, String(propertyId));
    return { ok: true, message: `Business Date ${closed.businessDate} closed.` };
  });
}
