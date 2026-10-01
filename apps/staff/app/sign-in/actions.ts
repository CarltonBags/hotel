"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInToTenant } from "@hoteloftware/auth";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";

export interface SignInState {
  error?: string;
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const tenant = await currentTenant();
  if (!tenant) return { error: "Unknown hotel company." };
  const login = String(formData.get("login") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!login || !password) return { error: "Enter your Username and password." };

  const result = await signInToTenant(auth(), pool(), {
    tenantId: tenant.id,
    login,
    password,
    headers: await headers(),
  });
  if (!result.ok) return { error: "Username or password is wrong." };

  // Forward the cookies Better Auth set on its response to this response.
  const jar = await cookies();
  for (const raw of result.response.headers.getSetCookie()) {
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
  redirect("/");
}

export async function signOut(): Promise<void> {
  await auth().api.signOut({ headers: await headers() });
  const jar = await cookies();
  for (const c of jar.getAll()) {
    if (c.name.includes("session_token")) jar.delete(c.name);
  }
  redirect("/sign-in");
}
