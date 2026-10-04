import { cookies } from "next/headers";
import { getPreferences, type Tenant } from "@hoteloftware/db";
import { ACCENT_COOKIE, LANGUAGE_COOKIE, SCOPE_COOKIE, THEME_COOKIE } from "./shell";
import { auth } from "./auth";
import { pool } from "./db";

/**
 * After a sign-in through Better Auth: forward the cookies it set on its
 * response to this response, drop the property chosen by whoever used the
 * screen before, and mirror the user's display settings so the next page
 * already paints correctly.
 */
export async function takeSignInCookies(response: Response, tenant: Tenant): Promise<void> {
  const jar = await cookies();
  for (const raw of response.headers.getSetCookie()) {
    const [pair = "", ...attrs] = raw.split(";");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq).trim();
    // The raw header value is URL-encoded; cookies().set encodes again, so decode first.
    const value = decodeURIComponent(pair.slice(eq + 1));
    const opts = new Map(
      attrs.map((a) => {
        const [k = "", ...v] = a.trim().split("=");
        return [k.toLowerCase(), v.join("=")] as const;
      }),
    );
    const sameSite = opts.get("samesite")?.toLowerCase();
    jar.set(name, value, {
      httpOnly: opts.has("httponly"),
      secure: opts.has("secure"),
      sameSite: sameSite === "strict" || sameSite === "none" ? sameSite : "lax",
      path: opts.get("path") || "/",
      ...(opts.has("max-age") ? { maxAge: Number(opts.get("max-age")) } : {}),
      ...(opts.has("expires") ? { expires: new Date(opts.get("expires")!) } : {}),
    });
  }
  // a shared screen: the property chosen by whoever signed in before does not carry over
  jar.delete(SCOPE_COOKIE);
  const session = await auth().api.getSession({ headers: new Headers({ cookie: jar.toString() }) });
  if (session) {
    const prefs = await getPreferences(pool(), session.user.id);
    const year = 60 * 60 * 24 * 365;
    jar.set(LANGUAGE_COOKIE, prefs.language, { path: "/", maxAge: year, sameSite: "lax" });
    jar.set(THEME_COOKIE, prefs.theme, { path: "/", maxAge: year, sameSite: "lax" });
    jar.set(ACCENT_COOKIE, tenant.accent, { path: "/", maxAge: year, sameSite: "lax" });
  }
}

/** Drop the session cookies (sign-out, Device lock). */
export async function dropSessionCookies(): Promise<void> {
  const jar = await cookies();
  for (const c of jar.getAll()) {
    if (c.name.includes("session_token")) jar.delete(c.name);
  }
  jar.delete(SCOPE_COOKIE);
}
