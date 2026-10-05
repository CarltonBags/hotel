"use server";

import { revalidatePath } from "next/cache";
import { setCantonProfile } from "@hoteloftware/db";
import { CANTON_FIELDS, CANTON_PRESETS, CANTONS, type Canton, type CantonField, type CantonProfile } from "@hoteloftware/domain";
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
    await setCantonProfile(pool(), c.schema, c.propertyId, CANTON_PRESETS[canton(field(formData, "canton"))]);
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
      grouping: (["adult", "couple", "family"] as const).find((g) => g === field(formData, "grouping")) ?? "family",
      retention: field(formData, "retention") === "end_of_next_january" ? { until: "end_of_next_january" } : { years },
      documentCopy: flag(formData, "documentCopy"),
      signature: (["handwritten", "tablet", "id_check"] as const).find((g) => g === field(formData, "signature")) ?? "handwritten",
      transmission: (["ti_export", "manual_entry", "keep"] as const).find((g) => g === field(formData, "transmission")) ?? "keep",
      ...(field(formData, "transmission") === "ti_export" ? { tiUserId: field(formData, "tiUserId") } : {}),
    };
    await setCantonProfile(pool(), c.schema, c.propertyId, profile);
    revalidatePath("/settings/canton");
  });
}
