"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { onboardPaymentAccount, refreshPaymentAccount, registerTerminalReader, removeTerminalReader, setRefundLimit } from "@hoteloftware/db";
import { paymentProvider } from "@hoteloftware/payments";
import { can } from "@hoteloftware/domain";
import { authorize, ForbiddenError, accessibleProperties, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { decimalOrNull, field, formAction, type FormState } from "@/lib/form";

/** Built from configuration, never from request headers. */
function settingsUrl(slug: string, legalEntityId: string): string {
  const scheme = env.authUrl.startsWith("https") ? "https" : "http";
  return `${scheme}://${slug}.${env.appDomain}/settings/payments?account=${legalEntityId}`;
}

/** A Property Manager of one of the Legal Entity's properties (Owner and Tenant Admin everywhere) manages its payment account. */
async function authorizeAccount(legalEntityId: string) {
  const principal = await requirePrincipal();
  const props = (await accessibleProperties()).filter((p) => p.legalEntityId === legalEntityId);
  if (!props.some((p) => can(principal.actor, "manage_payment_settings", p.id))) throw new ForbiddenError("manage_payment_settings");
  return principal;
}

/** Start or continue the provider's onboarding for a Legal Entity; the browser goes to the provider and comes back here. */
export async function onboardAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let link: string | undefined;
  const state = await formAction(async () => {
    const legalEntityId = field(formData, "legalEntityId");
    const { tenant, session } = await authorizeAccount(legalEntityId);
    const back = settingsUrl(tenant.slug, legalEntityId);
    link = await onboardPaymentAccount(pool(), tenant.schemaName, paymentProvider(), { tenantId: tenant.id, legalEntityId, email: session.user.email, returnUrl: back, refreshUrl: back }, session.user.id);
  });
  if (link) redirect(link);
  return state;
}

export async function refreshAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const legalEntityId = field(formData, "legalEntityId");
    const { tenant } = await authorizeAccount(legalEntityId);
    await refreshPaymentAccount(pool(), tenant.schemaName, paymentProvider(), legalEntityId);
    revalidatePath("/settings/payments");
    return { ok: true, message: "Status updated." };
  });
}

export async function pairReaderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await authorize("manage_payment_settings", propertyId);
    await registerTerminalReader(pool(), tenant.schemaName, paymentProvider(), propertyId, { registrationCode: field(formData, "code"), label: field(formData, "label") }, session.user.id);
    revalidatePath("/settings/payments");
    return { ok: true, message: "Reader paired." };
  });
}

export async function removeReaderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant } = await authorize("manage_payment_settings", propertyId);
    await removeTerminalReader(pool(), tenant.schemaName, propertyId, field(formData, "id"));
    revalidatePath("/settings/payments");
    return { ok: true, message: "Removed." };
  });
}

export async function refundLimitAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant } = await authorize("manage_payment_settings", propertyId);
    const limit = decimalOrNull(formData, "limit");
    if (limit === null) throw new Error("Enter the limit");
    await setRefundLimit(pool(), tenant.schemaName, propertyId, limit);
    revalidatePath("/settings/payments");
    return { ok: true, message: "Saved." };
  });
}
