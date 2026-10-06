"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { endSupportAccess, reportIncident, scheduleMaintenance, setBankTransfer, setPrice, startSupportAccess, updateIncident } from "@hoteloftware/db";
import { todayIn, zonedInstant, type IncidentState } from "@hoteloftware/domain";
import { authorize } from "@/lib/authorize";
import { isSupportConsoleUser } from "@/lib/support";
import { pool } from "@/lib/db";
import { env, tenantUrl } from "@/lib/env";
import { field, formAction, type FormState } from "@/lib/form";
import { SUPPORT_COOKIE, currentSession } from "@/lib/tenant";

/** The support console (ticket 93): only the platform's support staff, signed in on the platform's own tenant. Returns their user id. */
async function supportStaffId(): Promise<string> {
  const staff = await isSupportConsoleUser();
  if (!staff) throw new Error("Only support staff");
  return staff.userId;
}

/** Open a customer's tenant with a reason; the access is logged and shown to the customer's Owner. */
export async function openTenantAction(_prev: FormState, formData: FormData): Promise<FormState & { url?: string }> {
  let url: string | undefined;
  const state = await formAction(async () => {
    const userId = await supportStaffId();
    const access = await startSupportAccess(pool(), { staffUserId: userId, tenantId: field(formData, "tenantId"), reason: field(formData, "reason"), platformSlug: env.platformSlug });
    // a one-time code, used up on arrival; the session's own secret never appears in a URL
    url = tenantUrl(access.slug, `/support-access?code=${encodeURIComponent(access.handoff)}`);
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

/** The customer's Owner ends a support access to the tenant. */
export async function endAccessByOwnerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant } = await authorize("view_support_accesses");
    await endSupportAccess(pool(), field(formData, "accessId"), tenant.id);
    revalidatePath("/settings/support-access");
    return { ok: true, message: "Support access ended." };
  });
}

export async function reportIncidentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const userId = await supportStaffId();
    const impact = field(formData, "impact") === "major" ? "major" : "minor";
    await reportIncident(pool(), { title: field(formData, "title"), impact, message: field(formData, "message") }, userId);
    // a major one reaches every customer's Property Managers too: the worker alerts them within a minute (ticket 86)
    return { ok: true, message: impact === "major" ? "Incident published on the status page; Property Managers are being alerted." : "Incident published on the status page." };
  });
}

export async function updateIncidentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const userId = await supportStaffId();
    await updateIncident(pool(), field(formData, "incidentId"), { state: field(formData, "state") as IncidentState, message: field(formData, "message") }, userId);
    return { ok: true, message: "Update published." };
  });
}

/** The price list (ticket 88): prices are configuration, entered here with the day they apply from. */
export async function setPriceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const userId = await supportStaffId();
    const unit = field(formData, "unit");
    const amount = field(formData, "amount");
    await setPrice(pool(), { key: field(formData, "key"), unit: unit === "property" ? "property" : unit === "percent" ? "percent" : "room", amount: amount ? Number(amount.replace(",", ".")) : Number.NaN, validFrom: field(formData, "validFrom") }, userId, todayIn("Europe/Berlin"));
    return { ok: true, message: "Price saved." };
  });
}

/** Bank transfer for a customer, on request (chains); off returns them to direct debit. */
export async function bankTransferAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const userId = await supportStaffId();
    const tenantId = field(formData, "tenantId");
    if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new Error("Choose a customer");
    await setBankTransfer(pool(), tenantId, formData.get("on") === "on", userId);
    return { ok: true, message: "Saved." };
  });
}

export async function scheduleMaintenanceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const userId = await supportStaffId();
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
