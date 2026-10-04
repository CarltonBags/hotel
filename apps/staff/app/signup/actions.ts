"use server";

import { join } from "node:path";
import { redirect } from "next/navigation";
import { createStaffUser } from "@hoteloftware/auth";
import { deleteTenant, findTenantBySlug, provisionTenant, seedDemoData, setTenantRole, trialsInLastHour } from "@hoteloftware/db";
import { loadMigrationsFromDir } from "@hoteloftware/db/migrations";
import { assertTenantSlug } from "@hoteloftware/domain";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { env, tenantUrl } from "@/lib/env";
import { field, formAction, type FormState } from "@/lib/form";


/** Start a 30-day trial (ticket 87): a new tenant in Test Mode, its Owner, and the demo property if chosen. */
export async function startTrialAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let slug = "";
  const result = await formAction(async () => {
    if (!env.trialSignup) throw new Error("Trials are not open at the moment");
    // a public form that creates a schema: capped platform-wide (counted in the database, nothing a caller can spoof)
    if ((await trialsInLastHour(pool())) >= env.trialsPerHour) throw new Error("Many trials are starting right now; please try again in an hour");
    slug = field(formData, "slug").toLowerCase();
    const company = field(formData, "company");
    const kind = field(formData, "kind");
    const password = String(formData.get("password") ?? "");
    if (!company) throw new Error("Enter your company's name");
    if (kind !== "demo" && kind !== "own") throw new Error("Choose demo data or your own data");
    assertTenantSlug(slug);
    if (password.length < 10) throw new Error("The password needs at least 10 characters");
    if (await findTenantBySlug(pool(), slug)) throw new Error("This address is taken; choose another");
    const tenant = await provisionTenant(pool(), { slug, name: company, trial: kind }, loadMigrationsFromDir(join(env.migrationsDir, "tenant")));
    try {
      const user = await createStaffUser(auth(), pool(), { tenantId: tenant.id, email: field(formData, "email"), username: field(formData, "username"), name: field(formData, "name"), password });
      await setTenantRole(pool(), { tenantId: tenant.id, userId: user.id, role: "owner" });
      if (kind === "demo") await seedDemoData(pool(), tenant.schemaName, user.id);
    } catch (err) {
      // all or nothing: a half-made trial would hold the address
      await deleteTenant(pool(), tenant.id).catch((cleanup) => console.error(`[signup] could not remove the half-made trial ${tenant.slug}`, cleanup));
      throw err;
    }
  });
  if (result.error) return result;
  redirect(tenantUrl(slug, "/sign-in"));
}
