"use server";

import { revalidatePath } from "next/cache";
import { SpaCancelTooLate, bookPortalAppointment, cancelPortalAppointment } from "@hoteloftware/db";
import { portalLanguage } from "@hoteloftware/domain";
import { portalText } from "@/i18n/portal";
import { pool } from "@/lib/db";
import { formAction, type FormState } from "@/lib/form";
import { announceSpa } from "@/lib/live";
import { currentTenant } from "@/lib/tenant";

/**
 * Spa self-booking in the Guest Portal (ticket 64): the Portal Link's key is
 * the guest's only authority, checked anew by the db layer; the spa's book
 * updates live.
 */
async function tenant() {
  const t = await currentTenant();
  if (!t) throw new Error("Not found");
  return t;
}

export async function spaBookAction(key: string, lang: string, input: { outletId: string; treatmentId: string; startsAt: string }): Promise<FormState> {
  const language = portalLanguage(lang, null);
  return formAction(async () => {
    const t = await tenant();
    const booked = await bookPortalAppointment(pool(), t.schemaName, key, { outletId: String(input.outletId), treatmentId: String(input.treatmentId), startsAt: new Date(String(input.startsAt)) }).catch((err: unknown) => {
      // the usual refusals in the guest's language
      const text = err instanceof Error ? err.message : "Not booked";
      throw new Error(/taken/.test(text) ? portalText(language, "spaTaken") : /already have/.test(text) ? portalText(language, "spaClash") : text);
    });
    await announceSpa(t.id, booked.propertyId);
    revalidatePath(`/g/${key}`);
    return { ok: true, message: "spaBooked" };
  });
}

export async function spaCancelAction(key: string, lang: string, appointmentId: string): Promise<FormState> {
  const language = portalLanguage(lang, null);
  return formAction(async () => {
    const t = await tenant();
    const done = await cancelPortalAppointment(pool(), t.schemaName, key, String(appointmentId)).catch((err: unknown) => {
      // the spa's rule, in the guest's language
      throw err instanceof SpaCancelTooLate ? new Error(portalText(language, "spaCancelRule", { n: err.hours })) : err;
    });
    await announceSpa(t.id, done.propertyId);
    revalidatePath(`/g/${key}`);
    return { ok: true, message: "spaCancelled" };
  });
}
