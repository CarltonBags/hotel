"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { endSupportAccess, isSupportStaff, reportIncident, scheduleMaintenance, startSupportAccess, updateIncident } from "@hoteloftware/db";
import { zonedInstant } from "@hoteloftware/domain";
import { requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { field, formAction, type FormState } from "@/lib/form";
import { SUPPORT_COOKIE, currentSession } from "@/lib/tenant";

/** The support console (ticket 93): only the platform's support staff, signed in on the platform's own tenant. */
async function staff() {
  const { session } = await requirePrincipal();
  if (session.support || !(await isSupportStaff(pool(), session.user.id))) throw new Error("Only support staff");
  return session.user.id;
}

/** Open a customer's tenant with a reason; the access is logged and shown to the customer's Owner. */
export async function openTenantAction(_prev: FormState, formData: FormData): Promise<FormState & { url?: string }> {
  let url: string | undefined;
  const state = await formAction(async () => {
    const userId = await staff();
    const access = await startSupportAccess(pool(), { staffUserId: userId, tenantId: field(formData, "tenantId"), reason: field(formData, "reason") });
    const scheme = env.authUrl.startsWith("https") ? "https" : "http";
    url = `${scheme}://${access.slug}.${env.appDomain}/support-access?token=${encodeURIComponent(access.token)}`;
    return { ok: true, message: "Access opened and logged." };
  });
  return { ...state, ...(url ? { url } : {}) };
}

/** End the support access of this browser on the customer's tenant. */
export async function endSupportAccessAction(): Promise<void> {
  const current = await currentSession();
  if (current?.session.support) await endSupportAccess(pool(), current.session.support.accessId);
  (await cookies()).delete(SUPPORT_COOKIE);
  redirect("/sign-in");
}

export async function reportIncidentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const userId = await staff();
    await reportIncident(pool(), { title: field(formData, "title"), impact: field(formData, "impact") === "major" ? "major" : "minor", message: field(formData, "message") }, userId);
    return { ok: true, message: "Incident published on the status page." };
  });
}

export async function updateIncidentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const userId = await staff();
    await updateIncident(pool(), field(formData, "incidentId"), { state: field(formData, "state") as "investigating" | "identified" | "monitoring" | "resolved", message: field(formData, "message") }, userId);
    return { ok: true, message: "Update published." };
  });
}

export async function scheduleMaintenanceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const userId = await staff();
    // typed in property time (Central Europe for every property of v1)
    const at = (name: string) => {
      const v = field(formData, name);
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(v);
      if (!m) throw new Error("Give start and end");
      return zonedInstant(m[1]!, m[2]!, "Europe/Berlin");
    };
    await scheduleMaintenance(pool(), { title: field(formData, "title"), description: field(formData, "description"), startsAt: at("startsAt"), endsAt: at("endsAt") }, userId);
    return { ok: true, message: "Maintenance announced on the status page." };
  });
}
