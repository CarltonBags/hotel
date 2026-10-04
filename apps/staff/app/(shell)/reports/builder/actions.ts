"use server";

import { revalidatePath } from "next/cache";
import { deleteSavedReport, saveReport } from "@hoteloftware/db";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";
import { builderFrom, queryMap } from "@/lib/report-builder";

/** Save the report as shown: private, or shared with the property (ticket 84). Only one property in scope: a shared report belongs to one. */
export async function saveReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, session } = await requirePrincipal();
    if (session.support) throw new Error("Not during a support access");
    const b = await builderFrom(queryMap(new URLSearchParams(field(formData, "query"))));
    if (!b.def) throw new Error(b.problem ?? "Choose columns first");
    if (b.properties.length !== 1) throw new Error("Choose one property in the navbar to save a report for it");
    await authorize("use_report_builder", b.properties[0]!.id);
    await saveReport(pool(), tenant.schemaName, { ownerId: session.user.id, propertyId: b.properties[0]!.id, name: field(formData, "name"), definition: b.def, shared: formData.get("shared") === "on" });
    revalidatePath("/reports/builder");
    return { ok: true, message: "Saved." };
  });
}

export async function deleteReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, session } = await requirePrincipal();
    if (session.support) throw new Error("Not during a support access");
    await deleteSavedReport(pool(), tenant.schemaName, field(formData, "id"), session.user.id);
    revalidatePath("/reports/builder");
  });
}
