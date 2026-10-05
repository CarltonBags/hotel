"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addPortalDocument, addPortalExtra, invitePortalGuest, portalView, requestPortalCode, savePrecheckin, storeFile, verifyPortalCode } from "@hoteloftware/db";
import { fileServices } from "@hoteloftware/storage";
import { pool } from "@/lib/db";
import { tenantUrl } from "@/lib/env";
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

const links = (slug: string) => ({ base: tenantUrl(slug, "").replace(/\/$/, "") });
const country = (v: string) => (/^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null);
const day = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export async function precheckinAction(key: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const t = await tenant();
    const docType = field(formData, "documentType");
    const companions = [0, 1, 2, 3, 4, 5]
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
      emailConsent: { granted: flag(formData, "consent"), wording: field(formData, "consentWording") },
    });
    const image = formData.get("documentImage");
    const view = await portalView(pool(), t.schemaName, key);
    if (image instanceof File && image.size > 0 && view?.kind === "reservation") {
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

/** Requests for a code, per address of the requester: a few an hour. */
const tries = new Map<string, number[]>();
async function limited(kind: string, max: number): Promise<boolean> {
  const h = await headers();
  const who = `${kind}:${(h.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "local"}`;
  const now = Date.now();
  const recent = (tries.get(who) ?? []).filter((t) => now - t < 3_600_000);
  recent.push(now);
  tries.set(who, recent);
  return recent.length > max;
}

export async function requestCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const t = await tenant();
    if (await limited("code", 10)) return { error: "tooMany" };
    await requestPortalCode(pool(), t.schemaName, { confirmationNumber: field(formData, "confirmation"), lastName: field(formData, "lastName") }, links(t.slug));
    // the same answer whether or not a booking matched
    return { ok: true, message: "codeSent" };
  });
}

export async function verifyCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await formAction(async () => {
    const t = await tenant();
    if (await limited("verify", 20)) return { error: "tooMany" };
    const key = await verifyPortalCode(pool(), t.schemaName, { confirmationNumber: field(formData, "confirmation"), lastName: field(formData, "lastName"), code: field(formData, "code") });
    if (!key) return { error: "wrongCode" };
    return { ok: true, message: key };
  });
  if (result.ok && result.message) redirect(`/g/${result.message}?lang=${field(formData, "lang") || "en"}`);
  return result;
}
