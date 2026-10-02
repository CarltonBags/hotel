"use server";

import { revalidatePath } from "next/cache";
import { DERIVATION_KINDS, FEE_KINDS, GUEST_LANGUAGES, MEAL_PLANS, PAYMENT_KINDS, RESTRICTION_FIELDS, isOneOf, type Supplement } from "@hoteloftware/domain";
import {
  closeProperty,
  closeRoomType,
  createCancellationPolicy,
  createPaymentPolicy,
  createRatePlan,
  listAgeBands,
  listRoomTypes,
  listServices,
  updateCancellationPolicy,
  updatePaymentPolicy,
  updateRatePlan,
  updateRoomType,
  type RatePlanInput,
} from "@hoteloftware/db";
import { propertyFor } from "@/lib/property-scope";
import { pool } from "@/lib/db";
import { decimalOrNull as decimal, field, flag, formAction, integerOrNull as integer, type FormState } from "@/lib/form";

const PATH = "/settings/rate-plans";

/** Every action names its property; Rate Plans, policies, floors and close-outs are one right. */
const scoped = (formData: FormData) => propertyFor("manage_rates", field(formData, "propertyId"));

function texts(formData: FormData, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const lang of GUEST_LANGUAGES) out[lang] = field(formData, `${prefix}_${lang}`);
  return out;
}

export async function saveRatePlan(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, property, userId } = await scoped(formData);
    const kind = field(formData, "kind");
    if (kind !== "base" && kind !== "derived") throw new Error("Choose whether the plan is a Base Rate Plan or a Derived Rate Plan");
    const mealPlan = field(formData, "mealPlan");
    if (!isOneOf(MEAL_PLANS, mealPlan)) throw new Error("Unknown meal plan");
    const edk = field(formData, "earlyDepartureFeeKind") || "none";
    if (!isOneOf(FEE_KINDS, edk)) throw new Error("Unknown fee kind");
    const [roomTypes, ageBands, services] = await Promise.all([
      listRoomTypes(pool(), schema, property.id),
      listAgeBands(pool(), schema, property.id),
      listServices(pool(), schema, property.id),
    ]);
    const supplements: Supplement[] = [];
    const single = decimal(formData, "supp_single");
    if (single !== null) supplements.push({ kind: "single", amount: single });
    const extra = decimal(formData, "supp_extra_adult");
    if (extra !== null) supplements.push({ kind: "extra_adult", amount: extra });
    for (const band of ageBands) {
      const amount = decimal(formData, `supp_child_${band.id}`);
      if (amount !== null) supplements.push({ kind: "child", ageBandId: band.id, amount });
    }
    const includedServices = services
      .filter((s) => flag(formData, `svc_${s.id}`))
      .map((s) => ({ serviceId: s.id, componentPrice: decimal(formData, `svcprice_${s.id}`) ?? s.defaultPrice }));
    const derivationValue = decimal(formData, "derivationValue");
    const derivationKind = field(formData, "derivationKind") || "percent";
    if (!isOneOf(DERIVATION_KINDS, derivationKind)) throw new Error("Unknown derivation kind");
    const input: Omit<RatePlanInput, "propertyId"> = {
      code: field(formData, "code"),
      name: field(formData, "name"),
      names: texts(formData, "name"),
      descriptions: texts(formData, "description"),
      policyTexts: texts(formData, "policyText"),
      kind,
      basePlanId: kind === "derived" ? field(formData, "basePlanId") || null : null,
      derivation: kind === "derived" ? { kind: derivationKind, value: derivationValue ?? Number.NaN } : null,
      inherits: Object.fromEntries(RESTRICTION_FIELDS.map((f) => [f, flag(formData, `inherit_${f}`)])),
      roomTypeIds: roomTypes.filter((t) => flag(formData, `rt_${t.id}`)).map((t) => t.id),
      baseOccupancy: integer(formData, "baseOccupancy") ?? 2,
      mealPlan,
      paymentPolicyId: field(formData, "paymentPolicyId"),
      cancellationPolicyId: field(formData, "cancellationPolicyId"),
      dateChangeAllowed: flag(formData, "dateChangeAllowed"),
      earlyDepartureFeeKind: edk,
      earlyDepartureFeePercent: decimal(formData, "earlyDepartureFeePercent"),
      public: flag(formData, "public"),
      rateCode: field(formData, "rateCode") || null,
      companyId: flag(formData, "public") ? null : field(formData, "companyId") || null,
      accommodationServiceId: field(formData, "accommodationServiceId") || null,
      soldOnChannels: flag(formData, "soldOnChannels"),
      supplements,
      includedServices,
    };
    const id = field(formData, "id");
    if (id) await updateRatePlan(pool(), schema, property.id, id, { ...input, active: flag(formData, "active") }, { userId });
    else await createRatePlan(pool(), schema, { propertyId: property.id, ...input }, { userId });
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function savePaymentPolicy(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, property } = await scoped(formData);
    const kind = field(formData, "kind");
    if (!isOneOf(PAYMENT_KINDS, kind)) throw new Error("Unknown payment kind");
    const input = { name: field(formData, "name"), kind, depositPercent: decimal(formData, "depositPercent") ?? undefined };
    const id = field(formData, "id");
    if (id) await updatePaymentPolicy(pool(), schema, property.id, id, input);
    else await createPaymentPolicy(pool(), schema, { propertyId: property.id, ...input });
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function saveCancellationPolicy(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, property } = await scoped(formData);
    const feeKind = field(formData, "feeKind");
    const noShowFeeKind = field(formData, "noShowFeeKind");
    if (!isOneOf(FEE_KINDS, feeKind) || !isOneOf(FEE_KINDS, noShowFeeKind)) throw new Error("Unknown fee kind");
    const input = {
      name: field(formData, "name"),
      freeUntilDays: flag(formData, "neverFree") ? null : (integer(formData, "freeUntilDays") ?? 0),
      freeUntilTime: field(formData, "freeUntilTime") || "18:00",
      feeKind,
      feePercent: decimal(formData, "feePercent") ?? undefined,
      noShowFeeKind,
      noShowFeePercent: decimal(formData, "noShowFeePercent") ?? undefined,
    };
    const id = field(formData, "id");
    if (id) await updateCancellationPolicy(pool(), schema, property.id, id, input);
    else await createCancellationPolicy(pool(), schema, { propertyId: property.id, ...input });
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

/** One form for every room type's Price Floor; an empty field clears it. */
export async function savePriceFloors(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, property } = await scoped(formData);
    const roomTypes = await listRoomTypes(pool(), schema, property.id);
    for (const t of roomTypes) {
      const value = decimal(formData, `floor_${t.id}`);
      if (value !== t.priceFloor) await updateRoomType(pool(), schema, property.id, t.id, { priceFloor: value });
    }
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

/** Shortcut: stop sell on every plan for the dates, for one room type or the whole property. */
export async function closeOut(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, property, userId } = await scoped(formData);
    const range = { from: field(formData, "from"), to: field(formData, "to") };
    const roomTypeId = field(formData, "roomTypeId");
    const result = roomTypeId ? await closeRoomType(pool(), schema, property.id, userId, roomTypeId, range) : await closeProperty(pool(), schema, property.id, userId, range);
    revalidatePath(PATH);
    return { ok: true, message: `Stop sell written into ${result.written} cells.` };
  });
}
