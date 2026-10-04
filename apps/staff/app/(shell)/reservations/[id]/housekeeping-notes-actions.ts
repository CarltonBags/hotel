"use server";

import { revalidatePath } from "next/cache";
import { addHousekeepingNote, removeHousekeepingNote } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";
import { reservationScope } from "@/lib/reservation-scope";

export async function addHousekeepingNoteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, reservation, userId, actor } = await reservationScope(field(formData, "reservationId"), "manage_housekeeping_notes");
    const code = field(formData, "code");
    await addHousekeepingNote(pool(), schema, reservation.id, code ? { code } : { text: field(formData, "text") }, { userId, actor });
    revalidatePath(`/reservations/${reservation.id}`);
  });
}

export async function removeHousekeepingNoteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, reservation, userId, actor } = await reservationScope(field(formData, "reservationId"), "manage_housekeeping_notes");
    await removeHousekeepingNote(pool(), schema, field(formData, "noteId"), { userId, actor });
    revalidatePath(`/reservations/${reservation.id}`);
  });
}
