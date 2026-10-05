"use server";

import { revalidatePath } from "next/cache";
import { revokePortalLink } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";
import { reservationScope } from "@/lib/reservation-scope";

/** A new Portal Link for the stay; the old one opens nothing (ticket 40). */
export async function revokePortalLinkAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, reservation } = await reservationScope(field(formData, "reservationId"), "manage_reservations");
    await revokePortalLink(pool(), schema, reservation.id, field(formData, "which") === "booking" ? "booking" : "stay");
    revalidatePath(`/reservations/${reservation.id}`);
    return { ok: true, message: "A new link was made; the old one opens nothing." };
  });
}
