import { NextResponse, type NextRequest } from "next/server";
import { resolveTenantSlugFromHeaders } from "@hoteloftware/domain";

/**
 * The subdomain selects the tenant before anything else runs. Requests on the
 * bare app domain or an unknown host shape are rewritten to /no-tenant.
 * Pages resolve the tenant the same way (lib/tenant.ts); the app never passes
 * the tenant on through a header of its own. The forwarded host is trusted
 * only as far as the Host header is: it selects which tenant's pages render,
 * and the session's own tenant is checked on every request regardless.
 */
export function proxy(request: NextRequest) {
  const slug = resolveTenantSlugFromHeaders(request.headers, process.env.APP_DOMAIN ?? "");
  if (slug || request.nextUrl.pathname === "/no-tenant") return NextResponse.next();
  return NextResponse.rewrite(new URL("/no-tenant", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
