"use server";

import { revalidatePath } from "next/cache";
import { PortalSpaRefusal, bookPortalAppointment, cancelPortalAppointment, type PortalSpaRefusalCode } from "@hoteloftware/db";
import { portalLanguage, type PortalLanguage } from "@hoteloftware/domain";
import { portalText, type PortalKey } from "@/i18n/portal";
import { pool } from "@/lib/db";
import { formAction, type FormState } from "@/lib/form";
import { announceSpa } from "@/lib/live";
import { currentTenant } from "@/lib/tenant";

/**
 * Spa self-booking in the Guest Portal (ticket 64): the Portal Link's key is
 * the guest's only authority, checked anew by the db layer; open spa books
 * update live.
 */
const REFUSAL_TEXT: Record<PortalSpaRefusalCode, PortalKey> = {
  taken: "spaTaken",
  passed: "spaPassed",
  clash: "spaClash",
  too_many: "spaTooMany",
  unavailable: "spaUnavailable",
  not_found: "spaNotFound",
  too_late: "spaCancelRule",
  no_longer: "spaNoLonger",
};

/** A refusal of the Portal in the guest's language; a link that opens nothing says so. */
const inLanguage = (language: PortalLanguage) => (err: unknown): never => {
  if (err instanceof PortalSpaRefusal) throw new Error(portalText(language, REFUSAL_TEXT[err.code], { n: err.hours }));
  if (err instanceof Error && /link does not open/.test(err.message)) throw new Error(portalText(language, "notFound"));
  throw err;
};

async function tenant() {
  const t = await currentTenant();
  if (!t) throw new Error("Not found");
  return t;
}

export async function spaBookAction(key: string, lang: string, input: { outletId: string; treatmentId: string; startsAt: string }): Promise<FormState> {
  const language = portalLanguage(lang, null);
  return formAction(async () => {
    const t = await tenant();
    const booked = await bookPortalAppointment(pool(), t.schemaName, key, { outletId: String(input.outletId), treatmentId: String(input.treatmentId), startsAt: new Date(String(input.startsAt)) }).catch(inLanguage(language));
    await announceSpa(t.id, booked.propertyId);
    revalidatePath(`/g/${key}`);
    return { ok: true, message: "spaBooked" };
  });
}

export async function spaCancelAction(key: string, lang: string, appointmentId: string): Promise<FormState> {
  const language = portalLanguage(lang, null);
  return formAction(async () => {
    const t = await tenant();
    const done = await cancelPortalAppointment(pool(), t.schemaName, key, String(appointmentId)).catch(inLanguage(language));
    await announceSpa(t.id, done.propertyId);
    revalidatePath(`/g/${key}`);
    return { ok: true, message: "spaCancelled" };
  });
}
