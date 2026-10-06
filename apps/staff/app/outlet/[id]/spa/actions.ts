"use server";

import { revalidatePath } from "next/cache";
import { addSpaHours, billAppointment, bookAppointment, cancelAppointment, changeSpaHours, markNoShow, spaGuests } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { formAction, type FormState } from "@/lib/form";
import { authorizeOutlet } from "@/lib/outlets";

/** The spa's appointment book (ticket 63): checked at the spa's property (Spa Staff, the managers), the db layer checks the spa itself. */
const book = (outletId: string) => authorizeOutlet("spa_book", { outletId });
const refresh = (outletId: string) => revalidatePath(`/outlet/${outletId}/spa`);

/** A local time at the spa as an instant (the form sends the offset it shows). */
const instant = (value: string) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error("Choose a time");
  return d;
};

export async function bookAppointmentAction(outletId: string, input: { treatmentId: string; therapistId: string; startsAt: string; reservationId: string | null; guestName: string }): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer } = await book(outletId);
    await bookAppointment(pool(), tenant.schemaName, outletId, { treatmentId: input.treatmentId, therapistId: input.therapistId, startsAt: instant(input.startsAt), reservationId: input.reservationId, guestName: input.guestName }, viewer);
    refresh(outletId);
    return { ok: true, message: "Booked." };
  });
}

export async function cancelAppointmentAction(outletId: string, appointmentId: string): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer } = await book(outletId);
    await cancelAppointment(pool(), tenant.schemaName, appointmentId, viewer);
    refresh(outletId);
    return { ok: true, message: "Cancelled." };
  });
}

export async function noShowAction(outletId: string, appointmentId: string): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer } = await book(outletId);
    await markNoShow(pool(), tenant.schemaName, appointmentId, viewer);
    refresh(outletId);
    return { ok: true, message: "Marked as no-show." };
  });
}

export async function billAppointmentAction(outletId: string, appointmentId: string): Promise<FormState & { billId?: string }> {
  let billId: string | undefined;
  const r = await formAction(async () => {
    const { tenant, viewer } = await book(outletId);
    billId = await billAppointment(pool(), tenant.schemaName, appointmentId, viewer);
    refresh(outletId);
  });
  return { ...r, ...(billId ? { billId } : {}) };
}

export async function spaHoursAction(outletId: string, input: { therapistId: string; from: string; to: string; released: boolean }): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer } = await book(outletId);
    await addSpaHours(pool(), tenant.schemaName, input.therapistId, { startsAt: instant(input.from), endsAt: instant(input.to), released: input.released }, viewer);
    refresh(outletId);
    return { ok: true, message: "Saved." };
  });
}

export async function changeSpaHoursAction(outletId: string, hoursId: string, change: { released: boolean } | "remove"): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer } = await book(outletId);
    await changeSpaHours(pool(), tenant.schemaName, hoursId, change === "remove" ? "remove" : { released: !!change.released }, viewer);
    refresh(outletId);
    return { ok: true, message: change === "remove" ? "Removed." : "Saved." };
  });
}

export async function spaGuestsAction(outletId: string, query: string) {
  const { tenant, viewer } = await book(outletId);
  return spaGuests(pool(), tenant.schemaName, outletId, String(query ?? ""), viewer);
}
