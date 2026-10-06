"use server";

import { revalidatePath } from "next/cache";
import { setCantonProfile } from "@hoteloftware/db";
import { CANTON_FIELDS, CANTON_GROUPINGS, CANTON_PRESETS, CANTON_SIGNATURES, CANTON_TRANSMISSIONS, CANTONS, type Canton, type CantonField, type CantonProfile, idCheckSignatureAllowed } from "@hoteloftware/domain";
import { cantonProfileOf } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, flag, formAction, type FormState } from "@/lib/form";

/** A Swiss property's Canton Profile (ticket 47): the Property Manager starts from a preset and adjusts it. */
async function scope(formData: FormData) {
  const propertyId = field(formData, "propertyId");
  const { tenant } = await authorize("manage_property_settings", propertyId);
  return { schema: tenant.schemaName, propertyId };
}

const canton = (v: string): Canton => {
  if (!(CANTONS as readonly string[]).includes(v)) throw new Error("Choose the canton");
  return v as Canton;
};

export async function presetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    // the establishment's Tessin id is the property's own: kept across presets
    const tiUserId = (await cantonProfileOf(pool(), c.schema, c.propertyId))?.tiUserId;
    const preset = CANTON_PRESETS[canton(field(formData, "canton"))];
    await setCantonProfile(pool(), c.schema, c.propertyId, { ...preset, ...(preset.transmission === "ti_export" && tiUserId ? { tiUserId } : {}) });
    revalidatePath("/settings/canton");
  });
}

export async function profileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    const which = canton(field(formData, "canton"));
    const years = Number(field(formData, "retentionYears"));
    const profile: CantonProfile = {
      canton: which,
      registers: field(formData, "registers") === "all" ? "all" : "foreign",
      extraFields: CANTON_FIELDS.filter((f: CantonField) => formData.getAll("extraFields").includes(f)),
      grouping: CANTON_GROUPINGS.find((g) => g === field(formData, "grouping")) ?? "couple",
      retention: field(formData, "retention") === "end_of_next_january" ? { until: "end_of_next_january" } : { years },
      documentCopy: flag(formData, "documentCopy"),
      signature: CANTON_SIGNATURES.find((g) => g === field(formData, "signature")) ?? "handwritten",
      transmission: CANTON_TRANSMISSIONS.find((g) => g === field(formData, "transmission")) ?? "keep",
      ...(field(formData, "transmission") === "ti_export" ? { tiUserId: field(formData, "tiUserId") } : {}),
      idCheckConfirmed: flag(formData, "idCheckConfirmed"),
    };
    if (profile.signature === "id_check" && !idCheckSignatureAllowed(profile)) throw new Error(profile.canton === "GR" ? "Graubünden asks a signature" : "Confirm with your canton that the ID Check may stand in for the signature, then tick that box");
    await setCantonProfile(pool(), c.schema, c.propertyId, profile);
    revalidatePath("/settings/canton");
  });
}
