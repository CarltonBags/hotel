import { cookies } from "next/headers";
import { DEVICE_COOKIE, deviceByToken, type DeviceInfo } from "@hoteloftware/auth";
import { isLanguage } from "@hoteloftware/domain";
import { messagesFor, type Messages } from "@/i18n/messages";
import { pool } from "./db";
import { LANGUAGE_COOKIE } from "./shell";
import { env } from "./env";

/** The enrolled Device this browser carries the token of, if any (also a revoked one). Server only. */
export async function currentDevice(): Promise<DeviceInfo | null> {
  return deviceByToken(pool(), (await cookies()).get(DEVICE_COOKIE)?.value);
}

/** Keep the Device token: httpOnly, for as long as browsers allow (400 days), renewed on use. */
export async function keepDeviceToken(token: string): Promise<void> {
  (await cookies()).set(DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: env.authUrl.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
  });
}

/** Messages for the Device pages, which render before anyone signs in: the language last used in this browser. */
export async function deviceMessages(): Promise<Messages> {
  const lang = (await cookies()).get(LANGUAGE_COOKIE)?.value ?? "";
  return messagesFor(isLanguage(lang) ? lang : "en");
}
