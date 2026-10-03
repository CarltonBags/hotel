"use server";

import { revalidatePath } from "next/cache";
import { removeCityTaxExemption, setCityTaxExemption } from "@hoteloftware/db";
import type { CityTaxExemptionReason } from "@hoteloftware/domain";
import { announceReservations } from "@/lib/live";
import { reservationScope } from "@/lib/reservation-scope";
import { pool } from "@/lib/db";
import { formAction, type FormState } from "@/lib/form";

/** City Tax exemptions on one reservation (ticket 30): Front Desk and Property Manager, while the stay is open. */

export async function setCityTaxExemptionAction(reservationId: string, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId, "check_in");
    const file = formData.get("document");
    const document = file instanceof File && file.size > 0 ? { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) } : null;
    await setCityTaxExemption(
      pool(),
      schema,
      reservation.id,
      { person: Number(formData.get("person")), reason: String(formData.get("reason") ?? "") as CityTaxExemptionReason, note: String(formData.get("note") ?? ""), document },
      userId,
    );
    revalidatePath(`/reservations/${reservation.id}`);
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: "Exemption saved." };
  });
}

export async function removeCityTaxExemptionAction(reservationId: string, exemptionId: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId, "check_in");
    await removeCityTaxExemption(pool(), schema, reservation.id, String(exemptionId), userId);
    revalidatePath(`/reservations/${reservation.id}`);
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: "Exemption removed." };
  });
}
