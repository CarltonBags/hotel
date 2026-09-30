"use server";

import { redirect } from "next/navigation";
import { acceptInvitation } from "@hoteloftware/auth/invitations";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";
import { currentTenant } from "@/lib/tenant";

export async function accept(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const tenant = await currentTenant();
    if (!tenant) throw new Error("Unknown hotel company.");
    const password = String(formData.get("password") ?? "");
    if (password !== String(formData.get("passwordRepeat") ?? "")) throw new Error("The passwords do not match.");
    await acceptInvitation(auth(), pool(), {
      token: field(formData, "token"),
      password,
      name: field(formData, "name"),
      expectedTenantId: tenant.id,
    });
    redirect("/sign-in");
  });
}
