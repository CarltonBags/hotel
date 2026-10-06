"use server";

import { revalidatePath } from "next/cache";
import { createTillConnection, rotateTillKey, updateTillConnection } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, flag, formAction, type FormState } from "@/lib/form";

/** External tills (ticket 65): the Property Manager connects them; the key is shown once. */
const viewerOf = (p: Awaited<ReturnType<typeof authorize>>) => ({ userId: p.session.user.id, actor: p.actor });
const PATH = "/settings/tills";

/** The Tax Code chosen per till rate: fields "rate_<n>". */
function taxCodes(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith("rate_") && typeof v === "string" && v) out[k.slice(5)] = v;
  return out;
}

export async function createTillAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const p = await authorize("manage_outlets", propertyId);
    const asked = field(formData, "kind");
    const kind = asked === "lightspeed" || asked === "fias" ? asked : "api";
    const { key } = await createTillConnection(
      pool(),
      p.tenant.schemaName,
      propertyId,
      { kind, name: field(formData, "name"), businessReference: field(formData, "businessReference"), revenueAccount: field(formData, "revenueAccount"), tipAccount: field(formData, "tipAccount"), taxCodes: taxCodes(formData) },
      viewerOf(p),
    );
    revalidatePath(PATH);
    return { ok: true, message: `Connected. The till's key, shown this once: ${key}` };
  });
}

export async function updateTillAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const p = await authorize("manage_outlets", field(formData, "propertyId"));
    await updateTillConnection(
      pool(),
      p.tenant.schemaName,
      field(formData, "id"),
      { name: field(formData, "name"), businessReference: field(formData, "businessReference"), revenueAccount: field(formData, "revenueAccount"), tipAccount: field(formData, "tipAccount"), taxCodes: taxCodes(formData), active: flag(formData, "active") },
      viewerOf(p),
    );
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function rotateTillKeyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const p = await authorize("manage_outlets", field(formData, "propertyId"));
    const key = await rotateTillKey(pool(), p.tenant.schemaName, field(formData, "id"), viewerOf(p));
    revalidatePath(PATH);
    return { ok: true, message: `New key, shown this once (the old one no longer works): ${key}` };
  });
}
