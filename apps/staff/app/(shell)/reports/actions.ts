"use server";

import { revalidatePath } from "next/cache";
import { createReportSchedule, deleteReportSchedule } from "@hoteloftware/db";
import { SCHEDULE_FREQUENCIES, type ScheduleFrequency } from "@hoteloftware/domain";
import { requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";
import { reportRequestFrom } from "@/lib/reports";

/** Schedule the report as shown, for oneself only: it goes to the user's own address while they may see it (ticket 82). */
export async function scheduleReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, session } = await requirePrincipal();
    // a support access works in the customer's tenant without leaving anything of its own there
    if (session.support) throw new Error("Not during a support access");
    const frequency = field(formData, "frequency") as ScheduleFrequency;
    if (!SCHEDULE_FREQUENCIES.includes(frequency)) throw new Error("Daily, weekly or monthly");
    const query = Object.fromEntries(new URLSearchParams(field(formData, "query")));
    const parsed = await reportRequestFrom(query.kind ?? "", query);
    if (!parsed || !parsed.properties.length) throw new Error("You may not see this report here");
    const r = parsed.request;
    await createReportSchedule(pool(), tenant.schemaName, {
      userId: session.user.id,
      kind: r.kind,
      propertyIds: r.propertyIds,
      frequency,
      options: { grain: r.grain, compare: r.compare, roomTypeId: r.roomTypeId ?? null, ...(r.currency ? { currency: r.currency } : {}), ...(r.rates ? { rates: r.rates } : {}) },
      language: r.language,
    });
    revalidatePath(`/reports/${r.kind}`);
    return { ok: true, message: `Scheduled. It goes to ${session.user.email}.` };
  });
}

export async function deleteScheduleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, session } = await requirePrincipal();
    await deleteReportSchedule(pool(), tenant.schemaName, field(formData, "id"), session.user.id);
    revalidatePath("/reports", "layout");
  });
}
