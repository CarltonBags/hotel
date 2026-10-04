"use server";

import { revalidatePath } from "next/cache";
import { addClosedPeriod, removeClosedPeriod, setStatsSettings, submitTourismReport } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, integerOrNull, type FormState } from "@/lib/form";

/** Official tourism statistics (ticket 85): submission, settings and the opening calendar (Property Manager). */
const PATH = "/statistics";

async function scope(formData: FormData) {
  const propertyId = field(formData, "propertyId");
  const { tenant, session } = await authorize("tourism_statistics", propertyId);
  return { schema: tenant.schemaName, propertyId, userId: session.user.id };
}

export async function submitReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId, userId } = await scope(formData);
    const version = await submitTourismReport(pool(), schema, propertyId, field(formData, "month"), userId);
    revalidatePath("/", "layout");
    return { ok: true, message: version === 1 ? "Submitted and frozen." : `Correction submitted as version ${version}; the earlier versions stay as they were.` };
  });
}

export async function statsSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId } = await scope(formData);
    await setStatsSettings(pool(), schema, propertyId, { identity: field(formData, "identity"), deadlineDay: integerOrNull(formData, "deadlineDay") ?? 5 });
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved." };
  });
}

export async function addClosedPeriodAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId, userId } = await scope(formData);
    await addClosedPeriod(pool(), schema, propertyId, { from: field(formData, "from"), to: field(formData, "to"), reason: field(formData, "reason") }, userId);
    revalidatePath(PATH);
  });
}

export async function removeClosedPeriodAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, propertyId } = await scope(formData);
    await removeClosedPeriod(pool(), schema, propertyId, field(formData, "closedPeriodId"));
    revalidatePath(PATH);
  });
}
