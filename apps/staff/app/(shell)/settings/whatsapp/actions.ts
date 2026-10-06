"use server";

import { revalidatePath } from "next/cache";
import { connectWhatsApp, saveWhatsAppTemplate } from "@hoteloftware/db";
import { FakeWhatsAppProvider, whatsAppProvider } from "@hoteloftware/messaging";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";

/** The WhatsApp Module's settings (ticket 44): the Property Manager connects the number and words the templates. */
async function scope(propertyId: string) {
  return authorize("manage_property_settings", propertyId);
}

/** After Embedded Signup in the browser: the code and the account and number Meta named. */
export async function connectAction(propertyId: string, input: { code: string; wabaId: string; phoneNumberId: string; coexistence: boolean }): Promise<FormState> {
  return formAction(async () => {
    const { tenant, session } = await scope(propertyId);
    await connectWhatsApp(pool(), tenant.schemaName, whatsAppProvider(), { tenantId: tenant.id, propertyId, code: String(input.code), wabaId: String(input.wabaId), phoneNumberId: String(input.phoneNumberId), coexistence: input.coexistence === true }, session.user.id);
    revalidatePath("/settings/whatsapp");
  });
}

/** Development only (the stand-in provider): a test number instead of the signup. */
export async function connectTestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const provider = whatsAppProvider();
    if (!(provider instanceof FakeWhatsAppProvider) || process.env.NODE_ENV === "production") throw new Error("Not available");
    const { tenant, session } = await scope(propertyId);
    await connectWhatsApp(pool(), tenant.schemaName, provider, { tenantId: tenant.id, propertyId, code: "test", wabaId: `test_waba_${propertyId.slice(0, 8)}`, phoneNumberId: `test_pn_${propertyId.slice(0, 8)}`, coexistence: true }, session.user.id);
    revalidatePath("/settings/whatsapp");
  });
}

export async function templateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await scope(propertyId);
    await saveWhatsAppTemplate(pool(), tenant.schemaName, whatsAppProvider(), propertyId, field(formData, "templateId"), String(formData.get("text") ?? ""), session.user.id);
    revalidatePath("/settings/whatsapp");
  });
}
