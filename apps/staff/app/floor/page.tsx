import { redirect } from "next/navigation";
import { issueChangeKey } from "@hoteloftware/auth";
import { findProperty, floorDay, getFloorLanguage, getPreferences, listTenantUsers } from "@hoteloftware/db";
import { can, deviceIdleMinutes, isFloorLanguage } from "@hoteloftware/domain";
import { IdleLock } from "@/app/device/idle-lock";
import { floorMessages } from "@/i18n/floor";
import { pool } from "@/lib/db";
import { floorContext } from "@/lib/floor";
import { FloorApp } from "./floor-app";

export const dynamic = "force-dynamic";

/** The phone view for Housekeepers, Housekeeping Supervisors and Maintenance (ticket 35). */
export default async function FloorPage() {
  const ctx = await floorContext();
  if (!ctx) redirect("/");
  const { tenant, session, actor, propertyId } = ctx;
  const userId = session.user.id;
  const viewer = { userId, actor };
  const [day, chosen, prefs, users] = await Promise.all([floorDay(pool(), tenant.schemaName, propertyId, viewer), getFloorLanguage(pool(), userId), getPreferences(pool(), userId), listTenantUsers(pool(), tenant.id)]);
  const language = chosen ?? (isFloorLanguage(prefs.language) ? prefs.language : "en");
  // on an enrolled Device the phone keeps a key, so what it does offline is sent later under this user
  const changeKey = session.device ? await issueChangeKey(pool(), session.device.deviceId, userId) : null;
  const idle = session.device ? deviceIdleMinutes((await findProperty(pool(), tenant.schemaName, propertyId))?.deviceIdleMinutes) : null;
  return (
    <>
      {idle ? <IdleLock minutes={idle} /> : null}
      <FloorApp
      userId={userId}
      userName={session.user.name}
      initial={day}
      changeKey={changeKey}
      language={language}
      m={floorMessages(language)}
      names={Object.fromEntries(users.map((u) => [u.id, u.name]))}
      onDevice={session.device !== null}
      boardHref={can(actor, "assign_housekeeping", propertyId) ? "/housekeeping" : null}
      />
    </>
  );
}
