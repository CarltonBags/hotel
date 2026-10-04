import { NextResponse } from "next/server";
import { redeemSupportHandoff } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { env, tenantUrl } from "@/lib/env";
import { SUPPORT_COOKIE, currentTenant } from "@/lib/tenant";

/** A support access opened from the console arrives here on the customer's subdomain: the token becomes this browser's support session. */
export async function GET(req: Request): Promise<Response> {
  const tenant = await currentTenant();
  // the one-time code from the console is used up here and exchanged for the session's own secret
  const code = new URL(req.url).searchParams.get("code") ?? "";
  const session = tenant ? await redeemSupportHandoff(pool(), code, tenant.id) : null;
  if (!tenant || !session) return new Response("This support access is not valid here (the link works once, within two minutes)", { status: 403 });
  // the request's own URL may carry the internal host: go to the tenant's address
  const res = NextResponse.redirect(tenantUrl(tenant.slug));
  // host-only, like the session cookie: it never reaches another tenant's subdomain
  res.cookies.set(SUPPORT_COOKIE, session.secret, { httpOnly: true, secure: env.authUrl.startsWith("https"), sameSite: "lax", path: "/", expires: session.expiresAt });
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}
