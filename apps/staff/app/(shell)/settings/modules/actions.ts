"use server";

import { revalidatePath } from "next/cache";
import { findProperty, setModuleStep, switchModuleOff, switchModuleOn } from "@hoteloftware/db";
import { todayIn } from "@hoteloftware/domain";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";

async function scope(formData: FormData) {
  const { tenant, session } = await authorize("manage_modules");
  if (session.support) throw new Error("Modules are the customer's decision, not support's");
  const property = await findProperty(pool(), tenant.schemaName, field(formData, "propertyId"));
  if (!property) throw new Error("Property not found");
  return { schema: tenant.schemaName, property, userId: session.user.id, today: todayIn(property.timeZone) };
}

/** On at once; billed from the next month (ticket 88). */
export async function moduleOnAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    if (formData.get("confirm") !== "on") throw new Error("Confirm the price first");
    await switchModuleOn(pool(), c.schema, c.property.id, field(formData, "module"), c.userId, c.today);
    revalidatePath("/", "layout");
    return { ok: true, message: "Switched on." };
  });
}

/** Off at the end of the month; its data stays readable. */
export async function moduleOffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    await switchModuleOff(pool(), c.schema, c.property.id, field(formData, "module"), c.userId, c.today);
    revalidatePath("/", "layout");
    return { ok: true, message: "Switched off at the end of the month." };
  });
}

export async function moduleStepAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const c = await scope(formData);
    await setModuleStep(pool(), c.schema, c.property.id, field(formData, "module"), field(formData, "step"), formData.get("done") === "on");
    revalidatePath("/settings/modules");
  });
}
