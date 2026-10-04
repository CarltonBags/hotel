"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { redeemEnrolment, setPin } from "@hoteloftware/auth";
import { auth } from "@/lib/auth";
import { dropSessionCookies, takeSignInCookies } from "@/lib/auth-cookies";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { keepDeviceToken } from "@/lib/device";
import { formAction, type FormState } from "@/lib/form";
import { currentSession, currentTenant } from "@/lib/tenant";

/** Enrol this browser as a Device with the one-time code from the QR. */
export async function enrolAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const tenant = await currentTenant();
    if (!tenant) throw new Error("Unknown hotel company");
    const { token } = await redeemEnrolment(pool(), { tenantId: tenant.id, code: String(formData.get("code") ?? "") });
    await keepDeviceToken(token);
    redirect("/device");
  });
}

/** PIN Sign-in on this Device: the endpoint checks the Device, the role and the PIN. */
export async function pinSignInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const tenant = await currentTenant();
  if (!tenant) return { error: "Unknown hotel company." };
  let response: Response;
  try {
    // through the public endpoint, with this request's host, origin and cookies (the Device token among them)
    const h = new Headers(await headers());
    h.set("content-type", "application/json");
    h.delete("content-length");
    response = await auth().handler(
      new Request(`${env.authUrl}/api/auth/device/pin-sign-in`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ userId: String(formData.get("userId") ?? ""), pin: String(formData.get("pin") ?? "") }),
      }),
    );
  } catch {
    return { error: "Could not sign in. Please try again." };
  }
  const body = (await response.json().catch(() => ({}))) as { message?: string; mustChange?: boolean };
  if (!response.ok) return { error: body.message ?? "Could not sign in." };
  await takeSignInCookies(response, tenant);
  redirect(body.mustChange ? "/device/pin" : "/");
}

/** Lock the Device: the session ends, the lock screen shows (idle lock, or the user leaves). */
export async function lockDeviceAction(): Promise<void> {
  await auth().api.signOut({ headers: await headers() }).catch(() => undefined);
  await dropSessionCookies();
  redirect("/device");
}

/** Choose your own PIN (required after a first or reset PIN). */
export async function changePinAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const current = await currentSession();
    if (!current) redirect("/device");
    const pin = String(formData.get("pin") ?? "");
    if (pin !== String(formData.get("repeat") ?? "")) throw new Error("The two PINs differ");
    const userId = current.session.user.id;
    await setPin((await auth().$context).password.hash, pool(), { tenantId: current.tenant.id, userId, pin, byUserId: userId, mustChange: false });
    redirect("/");
  });
}
