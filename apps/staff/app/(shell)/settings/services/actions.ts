"use server";

import { revalidatePath } from "next/cache";
import { GUEST_LANGUAGES, can, isPostingRhythm, todayIn } from "@hoteloftware/domain";
import { PRESET_RATE_START, addTaxRate, applyTaxPreset, createService, createTaxCode, findProperty, findService, removeTaxRate, renameTaxCode, updateService, type ServicePatch } from "@hoteloftware/db";
import { ForbiddenError, authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";

const PATH = "/settings/services";

/** The property named in the form, only if the caller may see it (no existence leak to outsiders). */
async function property(formData: FormData) {
  const { tenant, actor } = await requirePrincipal();
  const propertyId = field(formData, "propertyId");
  if (!can(actor, "view_property", propertyId)) throw new ForbiddenError("view_property", propertyId);
  const p = await findProperty(pool(), tenant.schemaName, propertyId);
  if (!p) throw new Error("Property not found");
  return { tenant, actor, property: p };
}

/** A decimal typed into a number input; a comma decimal separator is accepted. */
function decimal(formData: FormData, name: string): number {
  const raw = field(formData, name).replace(",", ".");
  const n = Number(raw);
  if (raw === "" || !Number.isFinite(n)) throw new Error(`${name}: number expected`);
  return n;
}
const money = decimal;
const percent = decimal;

function names(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const lang of GUEST_LANGUAGES) out[lang] = field(formData, `name_${lang}`);
  return out;
}

/**
 * Field-level rights from the permission matrix: prices need Property Manager
 * or Revenue; Tax Codes and revenue accounts need Property Manager or
 * Accounting; everything else on a Service needs Property Manager.
 */
export async function saveService(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, actor, property: p } = await property(formData);
    const schema = tenant.schemaName;
    const rhythm = field(formData, "postingRhythm");
    if (!isPostingRhythm(rhythm)) throw new Error("Unknown posting rhythm");
    const input = {
      code: field(formData, "code"),
      name: field(formData, "name"),
      names: names(formData),
      defaultPrice: money(formData, "defaultPrice"),
      taxCodeId: field(formData, "taxCodeId"),
      revenueAccount: field(formData, "revenueAccount"),
      postingRhythm: rhythm,
      bookableOnline: formData.get("bookableOnline") === "on",
      // a hidden "off" precedes the checkbox so an unticked box still sends the field
      active: formData.getAll("active").includes("on"),
    };
    const id = field(formData, "id");
    if (!id) {
      await authorize("manage_property_settings", p.id);
      await createService(pool(), schema, { propertyId: p.id, ...input });
    } else {
      const current = await findService(pool(), schema, p.id, id);
      if (!current) throw new Error("Service not found");
      const patch: ServicePatch = {};
      if (input.defaultPrice !== current.defaultPrice) {
        if (!can(actor, "manage_service_prices", p.id)) throw new ForbiddenError("manage_service_prices", p.id);
        patch.defaultPrice = input.defaultPrice;
      }
      if (input.taxCodeId !== current.taxCodeId || input.revenueAccount !== current.revenueAccount) {
        if (!can(actor, "manage_tax_codes", p.id)) throw new ForbiddenError("manage_tax_codes", p.id);
        patch.taxCodeId = input.taxCodeId;
        patch.revenueAccount = input.revenueAccount;
      }
      const rest =
        input.code.toUpperCase() !== current.code ||
        input.name !== current.name ||
        input.postingRhythm !== current.postingRhythm ||
        input.bookableOnline !== current.bookableOnline ||
        input.active !== current.active ||
        GUEST_LANGUAGES.some((l) => (input.names[l] ?? "") !== (current.names[l] ?? ""));
      if (rest) {
        if (!can(actor, "manage_property_settings", p.id)) throw new ForbiddenError("manage_property_settings", p.id);
        Object.assign(patch, { code: input.code, name: input.name, names: input.names, postingRhythm: input.postingRhythm, bookableOnline: input.bookableOnline, active: input.active });
      }
      if (Object.keys(patch).length) await updateService(pool(), schema, p.id, id, patch);
    }
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function addTaxCode(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, property: p } = await property(formData);
    await authorize("manage_tax_codes", p.id);
    await createTaxCode(pool(), tenant.schemaName, p.legalEntityId, {
      code: field(formData, "code"),
      name: field(formData, "name"),
      rate: percent(formData, "rate"),
      validFrom: field(formData, "validFrom") || PRESET_RATE_START,
    });
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function saveTaxCode(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, property: p } = await property(formData);
    await authorize("manage_tax_codes", p.id);
    const id = field(formData, "id");
    const name = field(formData, "name");
    if (name) await renameTaxCode(pool(), tenant.schemaName, p.legalEntityId, id, name);
    const rate = field(formData, "rate");
    const validFrom = field(formData, "validFrom");
    if (rate !== "" || validFrom !== "") {
      if (rate === "" || validFrom === "") throw new Error("A new rate needs both a rate and a date");
      await addTaxRate(pool(), tenant.schemaName, p.legalEntityId, id, { rate: percent(formData, "rate"), validFrom }, todayIn(p.timeZone));
    }
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function dropTaxRate(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, property: p } = await property(formData);
    await authorize("manage_tax_codes", p.id);
    await removeTaxRate(pool(), tenant.schemaName, p.legalEntityId, field(formData, "id"), field(formData, "validFrom"), todayIn(p.timeZone));
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function applyPreset(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, property: p } = await property(formData);
    await authorize("manage_tax_codes", p.id);
    const created = await applyTaxPreset(pool(), tenant.schemaName, p.legalEntityId, p.country);
    revalidatePath(PATH);
    return { ok: true, message: `${created.length} Tax Codes added.` };
  });
}
