"use server";

import { revalidatePath } from "next/cache";
import { addRegistrationPerson, completeRegistrationPerson, confirmSignedOnPaper, findRegistration, openRegistration, recordIdCheck, registrationDocument, sendToTablet, takeBackFromTablet, type PersonInput } from "@hoteloftware/db";
import { renderMeldescheinPdf } from "@hoteloftware/invoices";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";
import { reservationScope } from "@/lib/reservation-scope";

/**
 * Meldeschein at the desk (ticket 45). Every action names the reservation;
 * its property decides the right (check-in), and the registration and person
 * ids from the browser must belong to it.
 */
async function scope(formData: FormData) {
  const reservationId = field(formData, "reservationId");
  const ctx = await reservationScope(reservationId, "check_in");
  const reg = await findRegistration(pool(), ctx.schema, reservationId);
  const personId = field(formData, "personId");
  if (personId && !reg?.persons.some((p) => p.id === personId)) throw new Error("Person not found");
  return { ...ctx, reg, personId, reservationId };
}

const done = (reservationId: string) => revalidatePath(`/reservations/${reservationId}`);

export async function openRegistrationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    await openRegistration(pool(), c.schema, c.reservationId, c.userId);
    done(c.reservationId);
  });
}

export async function addPersonAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    if (!c.reg) throw new Error("Open the registration first");
    const p: PersonInput = { role: field(formData, "role") as PersonInput["role"], firstName: field(formData, "firstName"), lastName: field(formData, "lastName"), dateOfBirth: field(formData, "dateOfBirth") || null, nationality: field(formData, "nationality") };
    await addRegistrationPerson(pool(), c.schema, c.reg.id, p);
    done(c.reservationId);
  });
}

export async function sendToTabletAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    if (!c.reg) throw new Error("Open the registration first");
    await sendToTablet(pool(), c.schema, { registrationId: c.reg.id, deviceId: field(formData, "deviceId"), ...(c.personId ? { personIds: [c.personId] } : {}) });
    done(c.reservationId);
  });
}

export async function takeBackAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    if (c.reg) await takeBackFromTablet(pool(), c.schema, c.reg.id);
    done(c.reservationId);
  });
}

export async function idCheckAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    if (formData.get("compared") !== "on") throw new Error("Confirm you compared the details with the passport");
    await recordIdCheck(pool(), c.schema, c.personId, field(formData, "note"), c.userId);
    done(c.reservationId);
  });
}

export async function signedOnPaperAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    await confirmSignedOnPaper(pool(), c.schema, c.personId, c.userId);
    done(c.reservationId);
  });
}

/** Complete: the form is rendered once and kept with the record. */
export async function completeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    const doc = await registrationDocument(pool(), c.schema, c.personId);
    const pdf = await renderMeldescheinPdf({ ...doc, signature: doc.signature ? new Uint8Array(doc.signature) : null });
    await completeRegistrationPerson(pool(), c.schema, c.personId, pdf);
    done(c.reservationId);
  });
}
