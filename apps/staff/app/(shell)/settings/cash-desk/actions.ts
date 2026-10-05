"use server";

import { revalidatePath } from "next/cache";
import { atDepArchive, atFiscalStatus, createCashRegister, fiscalArchive, markOutageReported, markSystemReceiptPrinted, registerAtClients, registerFiscalClients, setReceiptPrinter, setUpFiscalAt, setCashDesk, setCashRegisterActive, setFiscalScope, setUpFiscal } from "@hoteloftware/db";
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
    // with the TSE in use, the new register is its client at once (its first Receipt is signed, not left to the worker)
    await registerFiscalClients(pool(), tenant.schemaName, fiscalDeps(), propertyId).catch((err) => console.error("[fiscal] clients", err));
    await registerAtClients(pool(), tenant.schemaName, fiscalDeps(), propertyId).catch((err) => console.error("[fiscal] Austrian registers", err));
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
    await setUpFiscal(pool(), tenant.schemaName, fiscalDeps(), propertyId, session.user.id);
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
    const a = await fiscalArchive(pool(), tenant.schemaName, { ...fiscalDeps(), store: fileStore(), tenantId: tenant.id }, { propertyId, kind: "dsfinvk", from: field(formData, "from"), to: field(formData, "to") }, session.user.id);
    revalidatePath(PATH);
    return a.state === "completed" ? { ok: true, message: "The export is ready below." } : a.state === "failed" ? { ok: false, error: `The export failed: ${a.error ?? ""}` } : { ok: true, message: "The provider is preparing the export; ask again in a few minutes." };
  });
}

/** The desk's Receipt printer (Austria requires one). */
export async function receiptPrinterAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant } = await authorize("manage_cash_desk", propertyId);
    await setReceiptPrinter(pool(), tenant.schemaName, propertyId, field(formData, "printer"));
    revalidatePath(PATH);
    return { ok: true, message: "Saved." };
  });
}

/** Austria: the Legal Entity's signature unit, with its fiskaly organisation and the FinanzOnline web-service user (ticket 52). */
export async function setUpFiscalAtAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await authorize("manage_cash_desk", propertyId);
    const st = await atFiscalStatus(pool(), tenant.schemaName, propertyId);
    if (!st) throw new Error("Not an Austrian property");
    await setUpFiscalAt(
      pool(),
      tenant.schemaName,
      fiscalDeps(),
      st.legalEntity.id,
      { apiKey: field(formData, "apiKey"), apiSecret: field(formData, "apiSecret"), fon: { participantId: field(formData, "fonParticipantId"), userId: field(formData, "fonUserId"), pin: field(formData, "fonPin") } },
      session.user.id,
    );
    revalidatePath(PATH);
    return { ok: true, message: "The signature unit is set up and registered with FinanzOnline; the registers follow." };
  });
}

export async function outageReportedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await authorize("manage_cash_desk", propertyId);
    await markOutageReported(pool(), tenant.schemaName, propertyId, field(formData, "outageId"), session.user.id);
    revalidatePath(PATH);
    return { ok: true, message: "Marked as reported." };
  });
}

export async function systemReceiptPrintedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await authorize("manage_cash_desk", propertyId);
    await markSystemReceiptPrinted(pool(), tenant.schemaName, propertyId, field(formData, "receiptId"), session.user.id);
    revalidatePath(PATH);
    return { ok: true, message: "Marked as printed and checked." };
  });
}

export async function depExportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await authorize("manage_cash_desk", propertyId);
    const a = await atDepArchive(pool(), tenant.schemaName, { ...fiscalDeps(), store: fileStore(), tenantId: tenant.id }, { propertyId, from: field(formData, "from"), to: field(formData, "to") }, session.user.id);
    revalidatePath(PATH);
    return a.state === "completed" ? { ok: true, message: "The DEP export is ready below." } : { ok: false, error: `The export failed: ${a.error ?? ""}` };
  });
}
