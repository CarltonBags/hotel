"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { DEVICE_COOKIE, signInToTenant } from "@hoteloftware/auth";
import { auth } from "@/lib/auth";
import { dropSessionCookies, takeSignInCookies } from "@/lib/auth-cookies";
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
  await takeSignInCookies(result.response, tenant);
  redirect("/");
}

export async function signOut(): Promise<void> {
  await auth().api.signOut({ headers: await headers() });
  await dropSessionCookies();
  // an enrolled Device goes back to its lock screen
  redirect((await cookies()).has(DEVICE_COOKIE) ? "/device" : "/sign-in");
}
