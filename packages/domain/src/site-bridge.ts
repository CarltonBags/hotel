/**
 * The Site Bridge's health (ticket 68, ADR 0014): it calls in every few
 * seconds; quiet for two minutes it shows offline, for three the Property
 * Manager is alerted, once until it comes back.
 */
export const BRIDGE_ONLINE_SECONDS = 120;
export const BRIDGE_ALERT_SECONDS = 180;

export function bridgeOnline(lastSeenAt: Date | null, now: Date): boolean {
  return !!lastSeenAt && now.getTime() - lastSeenAt.getTime() <= BRIDGE_ONLINE_SECONDS * 1000;
}

export function bridgeAlertDue(lastSeenAt: Date | null, alertedAt: Date | null, now: Date): boolean {
  if (!lastSeenAt || now.getTime() - lastSeenAt.getTime() < BRIDGE_ALERT_SECONDS * 1000) return false;
  return !alertedAt || alertedAt < lastSeenAt;
}
