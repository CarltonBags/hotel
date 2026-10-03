"use server";

import { revalidatePath } from "next/cache";
import { addCityTaxVersion, createCityTaxRule, removeCityTaxVersion, setCityTaxPassOn, updateCityTaxRule, type CityTaxChange } from "@hoteloftware/db";
import {
  CITY_TAX_EVIDENCE,
  CITY_TAX_EXEMPTION_REASONS,
  CITY_TAX_KINDS,
  parseCityTaxFlat,
  parseCityTaxSteps,
  type CityTaxEvidence,
  type CityTaxKind,
  type CityTaxPassOn,
  type CityTaxPreset,
  type CityTaxReasonSetting,
} from "@hoteloftware/domain";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { decimalOrNull, field, flag, formAction, integerOrNull, type FormState } from "@/lib/form";

/** City Tax set-up (ticket 30): the Property Manager of the property. */

const PATH = "/settings/city-tax";

async function scope(formData: FormData) {
  const propertyId = field(formData, "propertyId");
  const { tenant, session } = await authorize("manage_property_settings", propertyId);
  return { schema: tenant.schemaName, propertyId, userId: session.user.id };
}

/** The stays in house whose City Tax changed, for the confirmation. */
function changed(c: CityTaxChange): FormState {
  revalidatePath(PATH);
  const parts = [
    c.changed.length ? `Recalculated: ${c.changed.map((x) => `${x.confirmationNumber} ${x.guestName} ${x.before.toFixed(2)} → ${x.after.toFixed(2)}`).join("; ")}.` : "No stay in house changed.",
    c.skipped.length ? `Not recalculated (check these stays): ${c.skipped.map((x) => `${x.confirmationNumber} ${x.guestName}: ${x.reason}`).join("; ")}.` : "",
  ];
  return { ok: true, message: `Saved. ${parts.filter(Boolean).join(" ")}` };
}

export async function passOnAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId } = await scope(formData);
    await setCityTaxPassOn(pool(), schema, propertyId, field(formData, "passOn") as CityTaxPassOn);
    revalidatePath(PATH);
    return { ok: true, message: "Saved. Applies to guests checked in from now on." };
  });
}

export async function createRuleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId, userId } = await scope(formData);
    const preset = field(formData, "preset");
    return changed(
      await createCityTaxRule(
        pool(),
        schema,
        propertyId,
        { preset: preset ? (preset as CityTaxPreset) : null, name: field(formData, "name"), taxCodeId: field(formData, "taxCodeId"), revenueAccount: field(formData, "revenueAccount") },
        userId,
      ),
    );
  });
}

export async function saveRuleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId, userId } = await scope(formData);
    const reasons: CityTaxReasonSetting[] = CITY_TAX_EXEMPTION_REASONS.filter((r) => flag(formData, `reason_${r}`)).map((reason) => {
      const evidence = field(formData, `evidence_${reason}`) as CityTaxEvidence;
      return { reason, evidence: CITY_TAX_EVIDENCE.includes(evidence) ? evidence : "none", param: integerOrNull(formData, `param_${reason}`) };
    });
    return changed(
      await updateCityTaxRule(
        pool(),
        schema,
        propertyId,
        {
          name: field(formData, "name"),
          taxCodeId: field(formData, "taxCodeId"),
          revenueAccount: field(formData, "revenueAccount"),
          baseServiceIds: formData.getAll("base").map(String),
          reasons,
        },
        userId,
      ),
    );
  });
}

export async function addVersionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId, userId } = await scope(formData);
    const kind = field(formData, "kind") as CityTaxKind;
    if (!CITY_TAX_KINDS.includes(kind)) throw new Error("Choose the kind of rule");
    return changed(
      await addCityTaxVersion(
        pool(),
        schema,
        propertyId,
        {
          validFrom: field(formData, "validFrom"),
          bookedFrom: field(formData, "bookedFrom") || null,
          kind,
          percent: decimalOrNull(formData, "percent"),
          nightCap: integerOrNull(formData, "nightCap"),
          stepBasis: field(formData, "stepBasis") === "per_room" ? "per_room" : "per_person",
          steps: kind === "step_table" ? parseCityTaxSteps(field(formData, "steps")) : [],
          beyondEvery: decimalOrNull(formData, "beyondEvery"),
          beyondAmount: decimalOrNull(formData, "beyondAmount"),
          flat: kind === "flat" ? parseCityTaxFlat(field(formData, "flat")) : [],
        },
        userId,
      ),
    );
  });
}

export async function removeVersionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId, userId } = await scope(formData);
    return changed(await removeCityTaxVersion(pool(), schema, propertyId, field(formData, "versionId"), userId));
  });
}
