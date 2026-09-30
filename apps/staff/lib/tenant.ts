import { cache } from "react";
import { headers } from "next/headers";
import { findTenantBySlug, resolveTenantSlug, type Tenant } from "@hoteloftware/db";
import { getTenantSession, type TenantSession } from "@hoteloftware/auth";
import { auth } from "./auth";
import { pool } from "./db";
import { env } from "./env";

/**
 * The tenant selected by the host of this request, or null on the bare app
 * domain. Derived from the host only, never from a header a client could set.
 */
export const currentTenant = cache(async (): Promise<Tenant | null> => {
  const h = await headers();
  const slug = resolveTenantSlug(h.get("host"), env.appDomain);
  if (!slug) return null;
  return findTenantBySlug(pool(), slug);
});

/** The signed-in user of this request, only if they belong to the request's tenant. */
export const currentSession = cache(async (): Promise<{ tenant: Tenant; session: TenantSession } | null> => {
  const tenant = await currentTenant();
  if (!tenant) return null;
  const session = await getTenantSession(auth(), await headers(), tenant.id);
  return session ? { tenant, session } : null;
});
