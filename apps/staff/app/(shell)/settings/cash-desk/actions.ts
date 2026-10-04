"use server";

import { revalidatePath } from "next/cache";
import { createCashRegister, setCashDesk, setCashRegisterActive } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { decimalOrNull, field, flag, formAction, type FormState } from "@/lib/form";

/** The property's cash desk settings and its Cash Registers (Property Manager, ticket 50). */
const PATH = "/settings/cash-desk";

export async function saveCashDeskAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant } = await authorize("manage_cash_desk", propertyId);
    await setCashDesk(pool(), tenant.schemaName, propertyId, {
      enabled: flag(formData, "enabled"),
      tolerance: decimalOrNull(formData, "tolerance") ?? 5,
      paidOutLimit: decimalOrNull(formData, "paidOutLimit") ?? 100,
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
