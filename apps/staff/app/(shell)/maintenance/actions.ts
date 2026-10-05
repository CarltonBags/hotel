"use server";

import { revalidatePath } from "next/cache";
import { fixIssue, reportIssue, storeFile, takeIssue, type FileKind } from "@hoteloftware/db";
import { PROBLEM_PICKS, URGENCIES, type ProblemPick, type Urgency } from "@hoteloftware/domain";
import { fileServices } from "@hoteloftware/storage";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, flag, formAction, type FormState } from "@/lib/form";
import { notifyFixed } from "@/lib/maintenance";

/** An uploaded photo, checked and stored (virus scan, tenant prefix); null when none was chosen. */
async function upload(formData: FormData, kind: FileKind, ctx: { tenantId: string; schema: string; propertyId: string; userId: string }): Promise<string | null> {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return null;
  return storeFile(pool(), ctx.schema, fileServices(), { tenantId: ctx.tenantId, kind, bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type, propertyId: ctx.propertyId, userId: ctx.userId });
}

async function scope(formData: FormData, action: "report_maintenance_issues" | "work_maintenance") {
  const propertyId = field(formData, "propertyId");
  const { tenant, session, actor } = await authorize(action, propertyId);
  return { tenant, viewer: { userId: session.user.id, actor }, ctx: { tenantId: tenant.id, schema: tenant.schemaName, propertyId, userId: session.user.id } };
}

export async function reportIssueAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { viewer, ctx } = await scope(formData, "report_maintenance_issues");
    const pick = field(formData, "pick");
    const urgency = field(formData, "urgency");
    if (!(PROBLEM_PICKS as readonly string[]).includes(pick) || !(URGENCIES as readonly string[]).includes(urgency)) throw new Error("Choose what is wrong and how urgent it is");
    const block = field(formData, "block");
    const photoFileId = await upload(formData, "issue_photo", ctx);
    await reportIssue(
      pool(),
      ctx.schema,
      {
        propertyId: ctx.propertyId,
        roomId: field(formData, "roomId") || null,
        place: field(formData, "place"),
        pick: pick as ProblemPick,
        urgency: urgency as Urgency,
        note: field(formData, "note"),
        photoFileId,
        block: block === "out_of_order" || block === "out_of_service" ? { kind: block, nights: Number(field(formData, "nights")) } : null,
      },
      viewer,
    );
    revalidatePath("/maintenance");
    return { ok: true, message: "Reported." };
  });
}

export async function takeIssueAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { viewer, ctx } = await scope(formData, "work_maintenance");
    await takeIssue(pool(), ctx.schema, ctx.propertyId, field(formData, "issueId"), viewer);
    revalidatePath("/maintenance");
  });
}

/** Fixed, with note and photo; with a Room Block in force the form says whether to end it (the room turns Dirty). The reporter is told. */
export async function fixIssueAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, viewer, ctx } = await scope(formData, "work_maintenance");
    const photoFileId = await upload(formData, "fix_photo", ctx);
    const fixed = await fixIssue(pool(), ctx.schema, ctx.propertyId, field(formData, "issueId"), { note: field(formData, "note"), photoFileId, endBlock: flag(formData, "endBlock") }, viewer);
    await notifyFixed(tenant, fixed);
    revalidatePath("/maintenance");
  });
}
