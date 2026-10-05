"use server";

import { revalidatePath } from "next/cache";
import { createCashRegister, fiscalArchive, setCashDesk, setCashRegisterActive, setFiscalScope, setUpFiscal } from "@hoteloftware/db";
import type { FiscalScope } from "@hoteloftware/domain";
import { fileStore } from "@hoteloftware/storage";
import { fiscalDeps } from "@/lib/fiscal";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { decimal, field, flag, formAction, type FormState } from "@/lib/form";

/** The property's cash desk settings and its Cash Registers (Property Manager, ticket 50). */
const PATH = "/settings/cash-desk";

export async function saveCashDeskAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant } = await authorize("manage_cash_desk", propertyId);
    await setCashDesk(pool(), tenant.schemaName, propertyId, {
      enabled: flag(formData, "enabled"),
      tolerance: decimal(formData, "tolerance"),
      paidOutLimit: decimal(formData, "paidOutLimit"),
      differenceAccount: field(formData, "differenceAccount"),
    });
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

export async function addRegisterAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant } = await authorize("manage_cash_desk", propertyId);
    await createCashRegister(pool(), tenant.schemaName, propertyId, field(formData, "name"));
    revalidatePath(PATH);
    return { ok: true, message: "Register added." };
  });
}

export async function registerActiveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant } = await authorize("manage_cash_desk", propertyId);
    await setCashRegisterActive(pool(), tenant.schemaName, propertyId, field(formData, "registerId"), flag(formData, "active"));
    revalidatePath(PATH);
  });
}

/** Set up the property's TSE (ticket 51). */
export async function setUpFiscalAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await authorize("manage_cash_desk", propertyId);
    const deps = fiscalDeps();
    if (!deps) throw new Error("The fiscal module is not configured (FISCAL_SECRET)");
    await setUpFiscal(pool(), tenant.schemaName, deps, propertyId, session.user.id);
    revalidatePath(PATH);
    return { ok: true, message: "The TSE is set up; Receipts are signed from now on." };
  });
}

export async function fiscalScopeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant } = await authorize("manage_cash_desk", propertyId);
    await setFiscalScope(pool(), tenant.schemaName, propertyId, field(formData, "scope") as FiscalScope);
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

/** The DSFinV-K export for a period of Business Dates; asked of the provider, then kept for download. */
export async function dsfinvkExportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await authorize("manage_cash_desk", propertyId);
    const deps = fiscalDeps();
    if (!deps) throw new Error("The fiscal module is not configured (FISCAL_SECRET)");
    const a = await fiscalArchive(pool(), tenant.schemaName, { ...deps, store: fileStore(), tenantId: tenant.id }, { propertyId, kind: "dsfinvk", from: field(formData, "from"), to: field(formData, "to") }, session.user.id);
    revalidatePath(PATH);
    return a.state === "completed" ? { ok: true, message: "The export is ready below." } : a.state === "failed" ? { ok: false, error: `The export failed: ${a.error ?? ""}` } : { ok: true, message: "The provider is preparing the export; ask again in a few minutes." };
  });
}
