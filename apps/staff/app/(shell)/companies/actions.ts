"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ROUTING_CATEGORIES } from "@hoteloftware/domain";
import { createCompany, updateCompany, type CompanyData } from "@hoteloftware/db";
import { authorizeAnywhere } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, flag, formAction, integerOrNull, type FormState } from "@/lib/form";

function companyData(formData: FormData): Partial<CompanyData> & { name: string } {
  return {
    name: field(formData, "name"),
    vatId: field(formData, "vatId") || null,
    addressLine1: field(formData, "addressLine1"),
    addressLine2: field(formData, "addressLine2"),
    postalCode: field(formData, "postalCode"),
    city: field(formData, "city"),
    country: field(formData, "country") || null,
    billingEmail: field(formData, "billingEmail") || null,
    phone: field(formData, "phone") || null,
    contactPerson: field(formData, "contactPerson"),
    buyerReference: field(formData, "buyerReference"),
    paymentTermsDays: integerOrNull(formData, "paymentTermsDays") ?? 14,
    onAccount: flag(formData, "onAccount"),
    routing: ROUTING_CATEGORIES.filter((c) => flag(formData, `routing_${c}`)),
    notes: field(formData, "notes"),
    active: formData.has("active") ? flag(formData, "active") : true,
  };
}

export async function createCompanyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let id: string | undefined;
  const state = await formAction(async () => {
    const { tenant, session } = await authorizeAnywhere("edit_companies");
    id = (await createCompany(pool(), tenant.schemaName, companyData(formData), { userId: session.user.id })).id;
  });
  if (id) redirect(`/companies/${id}`);
  return state;
}

export async function saveCompanyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, session } = await authorizeAnywhere("edit_companies");
    const id = field(formData, "id");
    await updateCompany(pool(), tenant.schemaName, id, companyData(formData), { userId: session.user.id });
    revalidatePath(`/companies/${id}`);
    return { ok: true, message: "Saved." };
  });
}
