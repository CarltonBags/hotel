"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { MAX_COMPANIONS, addPortalDocument, addPortalExtra, invitePortalGuest, portalView, requestPortalCode, savePrecheckin, storeFile, verifyPortalCode } from "@hoteloftware/db";
import { portalLanguage } from "@hoteloftware/domain";
import { portalText } from "@/i18n/portal";
import { fileServices } from "@hoteloftware/storage";
import { pool } from "@/lib/db";
import { guestLinks } from "@/lib/env";
import { field, flag, formAction, type FormState } from "@/lib/form";
import { currentTenant } from "@/lib/tenant";

/**
 * The Guest Portal's actions (ticket 40): no sign-in; the Portal Link's key
 * is the guest's only authority, checked anew on every action.
 */
async function tenant() {
  const t = await currentTenant();
  if (!t) throw new Error("Not found");
  return t;
}

const links = (slug: string) => guestLinks(slug);
const country = (v: string) => (/^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null);
const day = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export async function precheckinAction(key: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const t = await tenant();
    const docType = field(formData, "documentType");
    const companions = Array.from({ length: MAX_COMPANIONS }, (_, i) => i)
      .map((i) => ({ firstName: field(formData, `c${i}first`), lastName: field(formData, `c${i}last`), dateOfBirth: day(field(formData, `c${i}dob`)), nationality: country(field(formData, `c${i}nat`)) }))
      .filter((c) => c.firstName || c.lastName);
    await savePrecheckin(pool(), t.schemaName, key, {
      firstName: field(formData, "firstName"),
      lastName: field(formData, "lastName"),
      dateOfBirth: day(field(formData, "dateOfBirth")),
      nationality: country(field(formData, "nationality")),
      countryOfResidence: country(field(formData, "countryOfResidence")),
      addressLine1: field(formData, "addressLine1"),
      postalCode: field(formData, "postalCode"),
      city: field(formData, "city"),
      phone: field(formData, "phone"),
      documentType: docType === "passport" || docType === "id_card" || docType === "driving_licence" || docType === "other" ? docType : null,
      documentNumber: field(formData, "documentNumber"),
      documentCountry: country(field(formData, "documentCountry")),
      documentExpiry: day(field(formData, "documentExpiry")),
      arrivalTime: field(formData, "arrivalTime") || null,
      companions,
      // the wording is ours, in the language the guest saw it in, never the form's
      emailConsent: { granted: flag(formData, "consent"), wording: portalText(portalLanguage(field(formData, "lang"), null), "consent") },
    });
    const image = formData.get("documentImage");
    const view = await portalView(pool(), t.schemaName, key);
    // only where the property takes document pictures; checked before anything is stored
    if (image instanceof File && image.size > 0 && view?.kind === "reservation" && view.property.documentImages) {
      // the upload is the stay's own: its id comes from the key, never from the form
      const fileId = await storeFile(pool(), t.schemaName, fileServices(), { tenantId: t.id, kind: "id_document", bytes: new Uint8Array(await image.arrayBuffer()), contentType: image.type, propertyId: view.property.id, userId: `guest-portal:${view.stay.reservationId}` });
      await addPortalDocument(pool(), t.schemaName, key, fileId);
    }
    revalidatePath(`/g/${key}`);
    return { ok: true, message: "saved" };
  });
}

export async function extraAction(key: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const t = await tenant();
    await addPortalExtra(pool(), t.schemaName, key, field(formData, "serviceId"), Number(field(formData, "quantity") || "1"));
    revalidatePath(`/g/${key}`);
    return { ok: true, message: "added" };
  });
}

export async function inviteAction(key: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const t = await tenant();
    await invitePortalGuest(pool(), t.schemaName, key, field(formData, "reservationId"), field(formData, "email"), links(t.slug));
    return { ok: true, message: "invited" };
  });
}

export async function requestCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const t = await tenant();
    // limits are in the database: five codes an hour per stay, five tries per code
    await requestPortalCode(pool(), t.schemaName, { confirmationNumber: field(formData, "confirmation"), lastName: field(formData, "lastName") }, links(t.slug));
    // the same answer whether or not a booking matched
    return { ok: true, message: "codeSent" };
  });
}

export async function verifyCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await formAction(async () => {
    const t = await tenant();
    const key = await verifyPortalCode(pool(), t.schemaName, { confirmationNumber: field(formData, "confirmation"), lastName: field(formData, "lastName"), code: field(formData, "code") });
    if (!key) return { error: "wrongCode" };
    return { ok: true, message: key };
  });
  if (result.ok && result.message) redirect(`/g/${result.message}?lang=${portalLanguage(field(formData, "lang"), null)}`);
  return result;
}
