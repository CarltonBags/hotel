import { cache } from "react";
import { cookies, headers } from "next/headers";
import { findTenantBySlug, supportSessionFor, type Tenant } from "@hoteloftware/db";
import { resolveTenantSlugFromHeaders } from "@hoteloftware/domain";
import { getTenantSession, type TenantSession } from "@hoteloftware/auth";
import { auth } from "./auth";
import { pool } from "./db";
import { env } from "./env";

/**
 * The tenant selected by the host of this request, or null on the bare app
 * domain. Derived from the (forwarded) host, never from an app header a client could set.
 */
export const currentTenant = cache(async (): Promise<Tenant | null> => {
  const h = await headers();
  const slug = resolveTenantSlugFromHeaders(h, env.appDomain);
  if (!slug) return null;
  return findTenantBySlug(pool(), slug);
});

/** The cookie of a support access on a customer's subdomain (host-only). */
export const SUPPORT_COOKIE = "hs_support";

/** The signed-in user of this request, only if they belong to the request's tenant. */
export const currentSession = cache(async (): Promise<{ tenant: Tenant; session: TenantSession } | null> => {
  const tenant = await currentTenant();
  if (!tenant) return null;
  const session = await getTenantSession(auth(), pool(), await headers(), tenant.id);
  if (session) return { tenant, session };
  // the platform's support staff, opened with a logged reason (ticket 93)
  const support = await supportSessionFor(pool(), (await cookies()).get(SUPPORT_COOKIE)?.value, tenant.id, env.platformSlug);
  if (!support) return null;
  return {
    tenant,
    session: {
      user: { id: support.staffUserId, email: support.staffEmail, username: null, name: `${support.staffName} (Support)`, tenantId: tenant.id },
      session: { id: `support:${support.accessId}`, expiresAt: support.expiresAt },
      device: null,
      support: { accessId: support.accessId, reason: support.reason },
    },
  };
});
