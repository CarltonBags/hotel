"use server";

import { revalidatePath } from "next/cache";
import { setStatsExclusion } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";
import { reservationScope } from "@/lib/reservation-scope";

export async function statsExclusionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, reservation } = await reservationScope(field(formData, "reservationId"), "exclude_from_statistics");
    await setStatsExclusion(pool(), schema, reservation.id, field(formData, "include") === "on" ? null : field(formData, "reason"));
    revalidatePath(`/reservations/${reservation.id}`);
  });
}
