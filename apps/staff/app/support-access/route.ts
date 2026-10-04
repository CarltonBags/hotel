import { NextResponse } from "next/server";
import { supportSessionFor } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { SUPPORT_COOKIE, currentTenant } from "@/lib/tenant";

/** A support access opened from the console arrives here on the customer's subdomain: the token becomes this browser's support session. */
export async function GET(req: Request): Promise<Response> {
  const tenant = await currentTenant();
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const access = tenant ? await supportSessionFor(pool(), token, tenant.id) : null;
  if (!tenant || !access) return new Response("This support access is not valid here", { status: 403 });
  // the request's own URL may carry the internal host: go to the tenant's address
  const scheme = env.authUrl.startsWith("https") ? "https" : "http";
  const res = NextResponse.redirect(`${scheme}://${tenant.slug}.${env.appDomain}/`);
  // host-only, like the session cookie: it never reaches another tenant's subdomain
  res.cookies.set(SUPPORT_COOKIE, token, { httpOnly: true, secure: env.authUrl.startsWith("https"), sameSite: "lax", path: "/", expires: access.expiresAt });
  return res;
}
