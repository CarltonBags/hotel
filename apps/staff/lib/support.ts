import { isSupportStaff } from "@hoteloftware/db";
import { requirePrincipal } from "./authorize";
import { pool } from "./db";
import { env } from "./env";

/** May this signed-in user use the support console: support staff on the platform's own tenant, not inside a customer's tenant. Server only. */
export async function isSupportConsoleUser(): Promise<{ userId: string } | null> {
  const { session } = await requirePrincipal();
  if (session.support) return null;
  return (await isSupportStaff(pool(), session.user.id, env.platformSlug)) ? { userId: session.user.id } : null;
}
