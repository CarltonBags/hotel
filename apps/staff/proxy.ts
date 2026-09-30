import { NextResponse, type NextRequest } from "next/server";
import { resolveTenantSlug } from "@hoteloftware/domain";

/**
 * The subdomain selects the tenant before anything else runs. Requests on the
 * bare app domain or an unknown host shape are rewritten to /no-tenant.
 * Pages resolve the tenant from the host themselves (lib/tenant.ts); nothing
 * is passed through headers, so nothing can be forged.
 */
export function proxy(request: NextRequest) {
  const slug = resolveTenantSlug(request.headers.get("host"), process.env.APP_DOMAIN ?? "");
  if (slug || request.nextUrl.pathname === "/no-tenant") return NextResponse.next();
  return NextResponse.rewrite(new URL("/no-tenant", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
