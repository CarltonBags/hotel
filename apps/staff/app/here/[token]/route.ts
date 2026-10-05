import { NextResponse } from "next/server";
import { propertyOfLobbyToken } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { HERE_COOKIE } from "@/lib/here";
import { currentTenant } from "@/lib/tenant";

/** How long a scan of the lobby QR code counts as being at the hotel. */
const HERE_SECONDS = 3 * 60 * 60;

/**
 * The lobby QR code (ticket 49): a phone that scanned it is at the hotel, so
 * Self Check-in on the phone needs no "I am at the hotel". Then the guest
 * opens their Portal Link.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const tenant = await currentTenant();
  const propertyId = tenant ? await propertyOfLobbyToken(pool(), tenant.schemaName, (await params).token) : null;
  const res = NextResponse.redirect(new URL(propertyId ? "/here?ok=1" : "/here", req.url));
  if (propertyId) res.cookies.set(HERE_COOKIE, propertyId, { httpOnly: true, secure: env.authUrl.startsWith("https"), sameSite: "lax", path: "/", maxAge: HERE_SECONDS });
  return res;
}
