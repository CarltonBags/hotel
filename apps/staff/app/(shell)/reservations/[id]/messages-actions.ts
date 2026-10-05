"use server";

import { revalidatePath } from "next/cache";
import { sendGuestMessage } from "@hoteloftware/db";
import { MANUAL_MESSAGE_TYPES, type ManualMessageType } from "@hoteloftware/domain";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";
import { reservationScope } from "@/lib/reservation-scope";
import { guestLinks } from "@/lib/env";

/** Send the confirmation again (card and balance requests once the Guest Portal gives their link); it goes out with the next dispatch, within a minute. */
export async function sendGuestMessageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, reservation, userId, tenantSlug } = await reservationScope(field(formData, "reservationId"), "manage_reservations");
    const type = field(formData, "type");
    if (!(MANUAL_MESSAGE_TYPES as readonly string[]).includes(type)) throw new Error("This message cannot be sent by hand");
    await sendGuestMessage(pool(), schema, { reservationId: reservation.id, type: type as ManualMessageType, links: guestLinks(tenantSlug) }, userId);
    revalidatePath(`/reservations/${reservation.id}`);
    return { ok: true, message: "Queued; it goes out within a minute." };
  });
}
