import { issueChangeKey } from "@hoteloftware/auth";
import { findProperty, floorDay, getFloorLanguage, getPreferences, listTenantUsers, type FloorDay } from "@hoteloftware/db";
import { can, deviceIdleMinutes, isFloorLanguage, type FloorLanguage } from "@hoteloftware/domain";
import { pool } from "@/lib/db";
import { floorContext } from "@/lib/floor";

export const dynamic = "force-dynamic";

export interface FloorBoot {
  me: { id: string; name: string };
  day: FloorDay;
  language: FloorLanguage;
  /** On an enrolled Device: the key the phone keeps with its changes, so they are sent later under this user. */
  changeKey: string | null;
  names: Record<string, string>;
  onDevice: boolean;
  boardHref: string | null;
  idleMinutes: number | null;
}

/**
 * Everything the phone view needs, fetched by the page itself, so the page
 * the service worker keeps for offline use carries no data: the phone keeps
 * this encrypted instead.
 */
export async function GET(): Promise<Response> {
  const ctx = await floorContext();
  if (!ctx) return new Response(null, { status: 401 });
  const { tenant, session, actor, propertyId } = ctx;
  const userId = session.user.id;
  const [day, chosen, prefs, users] = await Promise.all([floorDay(pool(), tenant.schemaName, propertyId, { userId, actor }), getFloorLanguage(pool(), userId), getPreferences(pool(), userId), listTenantUsers(pool(), tenant.id)]);
  const boot: FloorBoot = {
    me: { id: userId, name: session.user.name },
    day,
    language: chosen ?? (isFloorLanguage(prefs.language) ? prefs.language : "en"),
    changeKey: session.device ? await issueChangeKey(pool(), session.device.deviceId, userId) : null,
    names: Object.fromEntries(users.map((u) => [u.id, u.name])),
    onDevice: session.device !== null,
    boardHref: can(actor, "assign_housekeeping", propertyId) ? "/housekeeping" : null,
    idleMinutes: session.device ? deviceIdleMinutes((await findProperty(pool(), tenant.schemaName, propertyId))?.deviceIdleMinutes) : null,
  };
  return Response.json(boot, { headers: { "cache-control": "no-store" } });
}
